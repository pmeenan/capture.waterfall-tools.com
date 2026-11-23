# Rough edges — findings log

Chrome, CDP, Android/ADB, WebUSB, extension-platform, storage-provider, and
tooling bugs, quirks, surprising limits, performance cliffs, and missing
capabilities encountered while building the capture tool. Log the ones that
burned real debugging time and will bite again — this is a save-future-you
log, not a compliance artifact.

This project sits on fast-moving, version-dependent browser behavior, so
record the exact Chrome version and channel, the OS, and (for Android) the
device and Android version with every entry. Spike results from M0 belong
here too.

**Before adding:** grep for the API/library involved to avoid duplicates.
**Before debugging weirdness:** check here first — it may be known.

A good entry says what environment it happened in and what was observed vs.
expected; include a reproduction when it's cheap to capture.

Format:

```
## RE-NNN: Title  (YYYY-MM-DD, status: open | fixed-upstream | worked-around | wontfix)
Environment / Repro or measurement / Observed / Expected / Impact / Links
```

Newest first. RE-numbers are never reused.

---

*(no findings yet)*
