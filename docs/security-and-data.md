# Security and data notes

This repository was prepared from a sanitized private buffer import.

The following must not be committed:

- .env files;
- API keys, tokens, credentials, private keys;
- local databases such as .sqlite or .db;
- user/account files such as users.json;
- student/pupil submissions;
- exam logs or identifiable school records;
- generated dependency folders such as node_modules, .venv, target, build, .next;
- large generated artifacts unless explicitly required and licensed.

Before making this repository public, run a final safety scan and manually inspect any hits.
