'use client';
import { useState } from 'react';
import { Dialog } from './dialog';
import { Icon } from './icon';
import { Campaign, Health } from '@/lib/types';
export function NewCampaign({onClose,onCreated,health}:{onClose:()=>void;onCreated:(campaign:Campaign)=>void;health:Health|null}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();setError('');setBusy(true);
    const f=new FormData(e.currentTarget);
    try {
      const r=await fetch('/api/lab/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.get('name'),objective:f.get('objective'),max_seconds:Number(f.get('budget'))*60,train_steps:Number(f.get('steps')),dev_samples:Number(f.get('samples')),final_samples:Number(f.get('samples')),max_experiments:Number(f.get('experiments'))})});
      const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'Check the campaign configuration.');onCreated(data);
    }catch(e){setError(e instanceof Error?e.message:'Campaign could not start.');}finally{setBusy(false);}
  }
  const ready=health?.services.terse.connected&&health.services.relay.connected;
  return <Dialog title="Start a research campaign" subtitle="A model, an objective, and a bounded compute window." onClose={onClose} wide><form onSubmit={submit} className="campaign-form">
    <div className="form-model"><span className="model-monogram">Q</span><div><strong>Qwen2.5-0.5B-Instruct</strong><span>494M parameters · Apache 2.0 · pinned revision</span></div><span className="tag">Local GPU</span></div>
    <label>Campaign name<input name="name" defaultValue="Mathematical reasoning" minLength={3} maxLength={80} required autoFocus/></label>
    <label>Research objective<textarea name="objective" defaultValue="Improve multi-step mathematical reasoning without benchmark leakage." rows={3} minLength={10} maxLength={500} required/><span className="field-help">The objective is immutable once the campaign begins.</span></label>
    <div className="form-grid"><label>Compute time limit<select name="budget" defaultValue="60"><option value="10">10 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></label><label>Experiment budget<select name="experiments" defaultValue="2"><option value="1">1 experiment</option><option value="2">2 experiments</option><option value="3">3 experiments</option><option value="4">4 experiments</option></select></label></div>
    <div className="form-grid"><label>Optimization steps per experiment<select name="steps" defaultValue="96"><option value="24">24 steps</option><option value="48">48 steps</option><option value="96">96 steps</option><option value="192">192 steps</option></select></label><label>Examples per evaluation split<select name="samples" defaultValue="24"><option value="8">8 problems · fast check</option><option value="24">24 problems · research run</option><option value="64">64 problems · stronger estimate</option><option value="100">100 problems</option></select></label></div>
    <div className="form-boundary"><Icon name="governance"/><div><strong>Governance is required</strong><p>Protected test data, fixed reward function, provenance checks, and a 25 percentage point regression limit. All checkpoint promotions require approval.</p></div></div>
    <div className="inline-notice"><Icon name="record"/><span>Screen recording is separate from training. Start capture before launch if you need a complete research video.</span></div>
    {error&&<p className="form-error" role="alert">{error}</p>}{!ready&&<p className="form-error">Terse and Agent Relay must be connected before launch.</p>}
    <footer className="dialog-actions"><span className="muted small">GSM8K subset · seed 42 · no cloud GPU billing</span><button type="submit" className="button primary" disabled={busy||!ready}>{busy?'Initializing campaign…':'Launch campaign'}<Icon name="arrow" size={16}/></button></footer>
  </form></Dialog>;
}
