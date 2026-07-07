# Setup

General setup notes:

1. Inspect the repository structure.
2. Identify the technology stack from files such as package.json, requirements.txt, pyproject.toml, pom.xml, CMakeLists.txt, pubspec.yaml, or solution/project files.
3. Install dependencies using the appropriate ecosystem tool.
4. Avoid committing generated dependency folders.

Common examples:

`ash
npm install
npm run dev
`

`ash
python -m venv .venv
pip install -r requirements.txt
`

`ash
cmake -S . -B build
cmake --build build
`

Adjust these commands to the actual project stack.
