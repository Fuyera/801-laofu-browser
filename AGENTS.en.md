# laofu-browser Collaboration Rules

[简体中文](AGENTS.md) | **English**

- Read CURRENT_CONTEXT.md first; product scope follows docs/DESIGN.md and docs/IMPLEMENTATION_PLAN.md.
- This is an independent shared-capability project; do not directly depend on or modify Fuyera, Qidao, or 000.
- vendor/huashu-chrome-1.2.0 is an immutable baseline; generate patches into runtime/ only through scripts/build-engine.mjs.
- Accept features, protocols, permissions, and recovery through behavioral tests and real execution evidence. Mocks or code existence do not establish live acceptance.
- Keep credentials and browser configuration in controlled runtime directories, outside commits. Never replay writes with unknown outcomes.
- Continue the user-approved P0→P5 sequence. Record unavailable environments such as Windows honestly and continue other implementation; do not claim complete v1.0.
- Do not automatically make the repository public, list releases in stores, push, or modify business consumers.
