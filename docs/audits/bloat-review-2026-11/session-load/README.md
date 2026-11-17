# What working sessions loaded and read

This folder holds one file per working session, written by `node scripts/session-load.mjs --step <id>` from the session's own transcript.
The first 20 files are the 'before'; the first 20 written after steps 2.1 and 2.40 are the 'after' (step 4.5 reads both).
A file holds paths, bytes and counts only, never a prompt, a message, a command, a search pattern or a person's data.
`node scripts/session-load.mjs --summary` prints the medians per code change and says WHOLE FILE READ for a rule file read nearly whole.
Default searches skip this folder (docs/audits/.rgignore): name it as the search path to search it.
Do not make up files to reach 20: each comes from a real working session.
