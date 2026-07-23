# Contributing to OKF MD Master

First off — thank you! Every contribution makes the OKF ecosystem stronger.

## How to Contribute

### 1. Report Bugs

- Check [existing issues](https://github.com/ThaiJenspacito/OKF_MD_Master/issues) first
- Describe what happened and what you expected
- Include steps to reproduce

### 2. Suggest Features

- Open an issue with the `enhancement` label
- Describe the problem you're solving
- How would OKF MD Master help?

### 3. Submit Code

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USER/OKF_MD_Master.git`
3. Create a branch: `git checkout -b feat/my-feature`
4. Make your changes
5. Test: `npm start` and open `http://localhost:5000`
6. Commit: `git commit -m "feat: my feature description"`
7. Push: `git push origin feat/my-feature`
8. Open a Pull Request

### 4. Create OKF Skills

Skills are the heart of OKF MD Master. To create one:

1. Write a `.md` file in `mock_documents/`
2. The system auto-detects and transforms it
3. Your skill appears in `data/okf_ready/` with YAML frontmatter

### 5. Improve Documentation

Fix typos, add examples, clarify explanations — every edit counts.

## Development Setup

```bash
git clone https://github.com/ThaiJenspacito/OKF_MD_Master.git
cd OKF_MD_Master
npm install
cp .env.example .env  # add your API keys
npm start             # http://localhost:5000
```

## Labels

| Label | Meaning |
|-------|---------|
| `good first issue` | Perfect for newcomers |
| `help wanted` | We'd love your help! |
| `bug` | Something is broken |
| `enhancement` | New feature or improvement |
| `documentation` | Documentation changes |

## Need Help?

- Open an [issue](https://github.com/ThaiJenspacito/OKF_MD_Master/issues)
- Check the [Live Demo](https://thai-jenspacito-okf-md.eu.run.app)
- Read [STRATEGY.md](docs/STRATEGY.md)
