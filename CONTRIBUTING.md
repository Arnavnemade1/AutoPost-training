# Contributing

These rules apply to every contributor, human or agent.

## No dates or times in documentation

Do not write calendar dates, days, times of day or timestamps into any README or other
documentation: no "verified on <date>", no event dates, no dated headings, no dated file
names, and no real timestamps in examples (use a placeholder such as `<ISO 8601 UTC>`).
Git history already records when something happened. Durations ("about 60 seconds") are
fine. Code and data files that genuinely record time (logs, manifests, `startedAt`
fields) are not documentation and keep their timestamps.

Before committing documentation, check that nothing slipped in:

```sh
git ls-files '*.md' | xargs grep -nE "January|February|March|April|June|July|August|September|October|November|December|20[0-9]{2}-[0-9]{2}-[0-9]{2}"
```
