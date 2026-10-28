"""Isolated worker: persisted assignments -> real training -> independent evaluation -> gated promotion."""
import json
import sys
import time
import traceback
from pathlib import Path
from dotenv import load_dotenv
from services.core import store, training
from services.core.director import propose
from services.core.engine import actor, add_review, artifact, cancelled, checkpoint_zip, governance, send, transition
from services.actors.generated import actors

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def run(cid):
    initial = store.get(cid)
    config = initial["config"]
    started = time.monotonic()
    deadline = started + config["max_seconds"]
    folder = store.ARTIFACTS / cid
    def stop():
        return cancelled(cid) or time.monotonic() >= deadline
    def save_field(**values):
        s = store.get(cid)
        s.update(values)
        store.save(s)
    def progress(stage):
        def update(done, total, prediction):
            save_field(progress={"stage": stage, "done": done, "total": total})
            store.event(cid, "evaluation_sample", f"{stage}: {done}/{total} evaluated", "evaluator", correct=prediction["correct"])
        return update
    def worlds(stage):
        def execute(row, answer, i):
            eid = f"{cid}-{stage}-{i}"
            world = actors.RLWorldActor.get(eid)
            world.reset(eid, row["question"], training.extract(row["answer"]), config["seed"]+i)
            result = json.loads(world.step(json.dumps({"episode_id": eid, "action_id": eid+"-submit", "expected_version": 0, "answer": answer})))
            result["id"] = eid
            s = store.get(cid)
            s["environments"] = [*s.get("environments", []), result]
            store.save(s)
            return result
        return execute

    try:
        train_rows, dev_rows, sealed = training.benchmark_data(config)
        manifest = {"dataset": "openai/gsm8k", "revision": training.DATASET_REVISION,
            "train_ids": [r["id"] for r in train_rows], "dev_ids": [r["id"] for r in dev_rows],
            "test_policy": "One held-out subset, queried only after immutable checkpoint selection", "seed": config["seed"]}
        (folder / "dataset-manifest.json").write_text(json.dumps(manifest, indent=2))
        artifact(cid, folder / "dataset-manifest.json", "dataset", "Dataset provenance")
        send(cid, "director", "evaluator", "BASELINE_REQUESTED", f"Evaluate {config['dev_samples']} disjoint development problems. Keep final test questions sealed.")
        transition(cid, "baseline", "Measuring the original model on development data")
        model, tokenizer = training.load()
        baseline = training.evaluate(model, tokenizer, dev_rows, progress("Baseline"), stop, worlds=worlds("baseline"))
        # A small declared math regression set. This is not a broad safety evaluation.
        regressions = [{"id": "reg-1", "question": "What is 6 times 7?", "answer": "#### 42"},
                       {"id": "reg-2", "question": "What is 81 divided by 9?", "answer": "#### 9"},
                       {"id": "reg-3", "question": "What is 125 minus 37?", "answer": "#### 88"},
                       {"id": "reg-4", "question": "What is 15 plus 26?", "answer": "#### 41"}]
        base_reg = training.evaluate(model, tokenizer, regressions, progress("Baseline regression"), stop, split="regression")
        training.unload(model)
        (folder / "baseline.json").write_text(json.dumps(baseline, indent=2))
        artifact(cid, folder / "baseline.json", "evaluation", "Baseline evaluation")
        save_field(baseline=baseline, baseline_regression=base_reg)
        send(cid, "evaluator", "director", "BASELINE_COMPLETED", f"Baseline: {baseline['correct']}/{baseline['n']} correct ({baseline['score']*100:.1f}%). {baseline['n']-baseline['correct']} failures available for diagnosis.")
        previous = []
        best = None
        for index in range(config["max_experiments"]):
            if stop():
                raise InterruptedError("Campaign budget reached or cancellation requested")
            transition(cid, "diagnosing", "Research director is selecting the next experiment from measured evidence")
            proposal = propose(config, baseline if not best else best["evaluation"], previous)
            save_field(director=proposal["director"])
            expid = f"exp-{index+1:03d}"
            key = f"{cid}-{expid}"
            spec = {"id": expid, "strategy": proposal["strategy"], "hypothesis": proposal["hypothesis"], "proposal": proposal,
                    "status": "proposed", "created_at": store.now(), "max_steps": config["train_steps"], "metrics": []}
            experiment = actors.ExperimentActor.get(key)
            experiment.initialize(json.dumps(spec))
            s = store.get(cid)
            s["experiments"] = [*s.get("experiments", []), spec]
            store.save(s)
            def update_exp(_expid=expid, **changes):
                s = store.get(cid)
                for e in s["experiments"]:
                    if e["id"] == _expid:
                        e.update(changes)
                store.save(s)
            send(cid, "director", "data", "EXPERIMENT_PROPOSED", proposal["hypothesis"], expid)
            review = add_review(cid, {"id": key+"-preflight", "phase": "preflight", "reward_version": "exact-answer-v1", "sealed_data_access": False, "provenance_valid": True})
            if review["decision"] != "approved":
                experiment.update("rejected", json.dumps(review))
                update_exp(status="rejected", review=review)
                continue
            # Reserve a bounded execution window atomically. A single worker owns the M3.
            remaining = max(1, int(deadline-time.monotonic()))
            state = json.loads(actor(cid).snapshot())
            reservation = min(remaining, max(1, config["max_seconds"] - int(state["consumed_seconds"])))
            actor(cid).reserve(key, reservation)
            exp_started = time.monotonic()
            experiment.update("approved", "{}")
            send(cid, "data", "trainer", "EXPERIMENT_APPROVED", f"Provenance checked. {len(train_rows)} permitted training rows. LoRA rank {proposal['lora_rank']}, learning rate {proposal['learning_rate']}, {config['train_steps']} steps.", expid)
            transition(cid, "training", f"Training {expid}: {'targeted' if proposal['strategy']=='targeted_sft' else 'broad'} supervised LoRA")
            experiment.update("training", "{}")
            update_exp(status="training")
            def metric(m, _experiment=experiment, _expid=expid, _update=update_exp):
                _experiment.metric(json.dumps(m))
                state = json.loads(_experiment.snapshot())
                _update(metrics=state["metrics"])
                save_field(progress={"stage": _expid, "done": m["step"], "total": config["train_steps"]})
                store.event(cid, "metric", f"Step {m['step']} · loss {m['loss']:.4f}", "trainer", experiment_id=_expid, metric=m)
            adapter = folder / expid
            result = training.train(proposal, config, train_rows, adapter, metric, stop)
            artifact(cid, adapter / "training.json", "training", f"{expid} training configuration")
            artifact(cid, adapter / "adapter_model.safetensors", "checkpoint", f"{expid} LoRA weights")
            artifact(cid, checkpoint_zip(adapter), "checkpoint_zip", f"{expid} checkpoint bundle")
            send(cid, "trainer", "evaluator", "TRAINING_COMPLETED", f"{expid} saved. Weights changed: {result['weights_changed']}. SHA-256 {result['sha256'][:16]}. Reload independently for evaluation.", expid)
            transition(cid, "evaluating", "Loading the saved adapter into a fresh model for evaluation")
            experiment.update("evaluating", "{}")
            update_exp(status="evaluating", training=result)
            model, tokenizer = training.load(adapter)
            evaluation = training.evaluate(model, tokenizer, dev_rows, progress(expid+" evaluation"), stop, worlds=worlds(expid))
            reg = training.evaluate(model, tokenizer, regressions, progress(expid+" regression"), stop, split="regression")
            training.unload(model)
            (folder / f"{expid}-evaluation.json").write_text(json.dumps(evaluation, indent=2))
            artifact(cid, folder / f"{expid}-evaluation.json", "evaluation", f"{expid} development evaluation")
            transition(cid, "reviewing", "Independent integrity and regression checks before promotion")
            review = add_review(cid, {"id": key, "phase": "checkpoint", "reward_version": "exact-answer-v1", "sealed_data_access": False,
                "provenance_valid": True, "weights_changed": result["weights_changed"], "independent_reload": True,
                "artifact_verified": training.sha(adapter / "adapter_model.safetensors") == result["sha256"],
                "sha256": result["sha256"], "regression_drop": base_reg["score"]-reg["score"], "dev_score": evaluation["score"]})
            experiment.update("completed", json.dumps({"evaluation": evaluation, "review": review}))
            spent = min(reservation, time.monotonic()-exp_started)
            actor(cid).settle(key, spent)
            update_exp(status="completed" if review["decision"] == "approved" else "rejected", evaluation=evaluation, regression=reg, review=review)
            send(cid, "evaluator", "director", "EVALUATION_COMPLETED", f"{expid}: {evaluation['correct']}/{evaluation['n']} development answers correct. Review {review['decision']}. Regression change {(reg['score']-base_reg['score'])*100:+.1f} pp.", expid)
            previous.append({"strategy": proposal["strategy"], "score": evaluation["score"], "review": review["decision"], "learning_rate": proposal["learning_rate"]})
            if review["decision"] == "approved" and evaluation["score"] > baseline["score"] and (best is None or evaluation["score"] > best["evaluation"]["score"]):
                governance(cid).promote(key, result["sha256"])
                best = {"id": expid, "key": key, "evaluation": evaluation, "sha256": result["sha256"], "path": str(adapter)}
                save_field(best=best)
                send(cid, "governance", "director", "CHECKPOINT_APPROVED", f"{expid} passed independent checks. Development change: {(evaluation['score']-baseline['score'])*100:+.1f} percentage points.", expid)
            else:
                send(cid, "governance", "director", "STRATEGY_REVISED", f"{expid} will not be promoted. Choose the next experiment using these findings.", expid)
        # Selection freezes before protected data is read. No improvement is a valid outcome.
        selection = best["key"] if best else "baseline"
        actor(cid).freeze_selection(selection)
        if not actor(cid).claim_final():
            raise RuntimeError("Final evaluation already claimed; refuse repeated test access")
        transition(cid, "finalizing", "Selection frozen. Running the held-out test subset once on identical settings")
        final_rows = sealed()
        model, tokenizer = training.load()
        final_base = training.evaluate(model, tokenizer, final_rows, progress("Final baseline"), stop, split="sealed final")
        training.unload(model)
        if best:
            model, tokenizer = training.load(best["path"])
            final_best = training.evaluate(model, tokenizer, final_rows, progress("Final checkpoint"), stop, split="sealed final")
            training.unload(model)
        else:
            final_best = final_base
        final = {"baseline": final_base, "checkpoint": final_best, "checkpoint_id": selection,
                 "improvement_pp": (final_best["score"]-final_base["score"])*100,
                 "valid_improvement": bool(best and final_best["score"] > final_base["score"]),
                 "selection_basis": "development only", "test_queries_per_model": 1}
        save_field(final=final, elapsed_seconds=time.monotonic()-started, progress=None)
        (folder / "final-evaluation.json").write_text(json.dumps(final, indent=2))
        artifact(cid, folder / "final-evaluation.json", "evaluation", "Sealed final evaluation")
        report = {"campaign_id": cid, "model_id": training.MODEL_ID, "model_revision": training.MODEL_REVISION,
                  "config": config, "final": final, "limitations": ["Small GSM8K subset, not the full official harness or leaderboard", "Possible base model pretraining contamination", "Four math regression questions, not a broad safety claim", "Local sponsor runtimes; no claim of cloud durability", "SFT only. Environment rewards score real predictions; GRPO is not enabled."],
                  "snapshot": store.get(cid)}
        (folder / "report.json").write_text(json.dumps(report, indent=2))
        artifact(cid, folder / "report.json", "report", "Research report")
        send(cid, "director", "governance", "CAMPAIGN_COMPLETED", f"Final evaluation complete. {'Validated improvement measured.' if final['valid_improvement'] else 'No validated improvement claimed.'} All sample-level evidence preserved.")
        transition(cid, "completed", "Research complete. Evidence package ready.")
        from services.core.cloud import mirror
        mirror(cid)
    except Exception as e:
        s = store.get(cid)
        status = "cancelled" if isinstance(e, InterruptedError) else "failed"
        s.update(status=status, error=str(e), elapsed_seconds=time.monotonic()-started)
        store.save(s)
        store.event(cid, "error", str(e), "trainer")
        try:
            actor(cid).transition(status, str(e))
            state = json.loads(actor(cid).snapshot())
            for key, r in state["reservations"].items():
                if r["status"] == "reserved":
                    actor(cid).settle(key, min(r["seconds"], time.monotonic()-started))
        except Exception:
            pass
        traceback.print_exc()
        raise


if __name__ == "__main__":
    run(sys.argv[1])
