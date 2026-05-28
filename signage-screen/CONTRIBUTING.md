# Contributing to HexmonSignage Player

Thank you for your interest in contributing to the HexmonSignage Player! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Code Style](#code-style)
- [Documentation](#documentation)

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors.

### Our Standards

**Positive behavior includes:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

**Unacceptable behavior includes:**
- Harassment, trolling, or insulting comments
- Public or private harassment
- Publishing others' private information
- Other conduct which could reasonably be considered inappropriate

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm 9 or later
- Git
- Ubuntu 20.04+ (for testing) or Windows (for development)
- Basic knowledge of TypeScript and Electron

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/signage-player.git
   cd signage-player
   ```

3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/hexmon/signage-player.git
   ```

## Development Setup

### Install Dependencies

```bash
npm install
```

### Build Project

```bash
npm run build
```

### Run in Development Mode

```bash
npm run start:dev
```

### Run Tests

```bash
npm test
```

### Lint Code

```bash
npm run lint
```

### Format Code

```bash
npm run format
```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-new-renderer` - New features
- `fix/cache-corruption` - Bug fixes
- `docs/update-readme` - Documentation
- `refactor/improve-logging` - Code refactoring
- `test/add-unit-tests` - Tests

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

**Examples:**
```
feat(cache): add LRU eviction policy

Implement LRU eviction when cache exceeds maxBytes.
Protects now-playing content from eviction.

Closes #123
```

```
fix(websocket): handle reconnection edge case

Fix issue where WebSocket wouldn't reconnect after
network interruption lasting more than 5 minutes.

Fixes #456
```

### Keep Changes Focused

- One feature or fix per pull request
- Keep pull requests small and focused
- Split large changes into multiple PRs

### Update Documentation

- Update README.md if adding features
- Add JSDoc comments to new functions
- Update API.md for API changes
- Add troubleshooting entries if needed

## Testing

### Unit Tests

Write unit tests for new features:

```typescript
import { describe, it, expect } from 'vitest'
import { CacheManager } from './cache-manager'

describe('CacheManager', () => {
  it('should evict LRU items when cache is full', async () => {
    const cache = new CacheManager()
    // Test implementation
    expect(cache.getSize()).toBe(0)
  })
})
```

### Integration Tests

Test interactions between components:

```typescript
describe('Pairing Flow', () => {
  it('should complete pairing and receive certificate', async () => {
    // Test implementation
  })
})
```

### Manual Testing

Test on actual hardware:
1. Build package: `npm run package:deb`
2. Install on Ubuntu test system
3. Verify functionality
4. Check logs for errors

## Submitting Changes

### Before Submitting

- [ ] Code builds without errors
- [ ] All tests pass
- [ ] Code is linted and formatted
- [ ] Documentation is updated
- [ ] Commit messages follow convention
- [ ] Branch is up to date with main

### Pull Request Process

1. **Update your branch:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push to your fork:**
   ```bash
   git push origin feature/your-feature
   ```

3. **Create Pull Request:**
   - Go to GitHub and create a PR
   - Fill out the PR template
   - Link related issues
   - Add screenshots if UI changes

4. **Code Review:**
   - Address reviewer feedback
   - Push additional commits
   - Request re-review when ready

5. **Merge:**
   - Maintainer will merge when approved
   - Delete your branch after merge

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How was this tested?

## Checklist
- [ ] Code builds without errors
- [ ] Tests pass
- [ ] Documentation updated
- [ ] Follows code style
```

## Code Style

### TypeScript

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use async/await over callbacks
- Add type annotations for public APIs
- Use interfaces for object shapes

**Example:**
```typescript
interface CacheEntry {
  key: string
  value: Buffer
  timestamp: number
}

async function getEntry(key: string): Promise<CacheEntry | null> {
  // Implementation
}
```

### Naming Conventions

- **Classes:** PascalCase (`CacheManager`)
- **Functions:** camelCase (`getCacheEntry`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_CACHE_SIZE`)
- **Files:** kebab-case (`cache-manager.ts`)
- **Interfaces:** PascalCase with 'I' prefix optional (`CacheEntry`)

### File Organization

```
src/
├── main/           # Main process
│   ├── index.ts   # Entry point
│   └── services/  # Service modules
├── renderer/       # Renderer process
├── preload/        # Preload scripts
└── common/         # Shared code
```

### Error Handling

Always handle errors properly:

```typescript
try {
  await riskyOperation()
} catch (error) {
  logger.error({ error }, 'Operation failed')
  throw new CustomError('Friendly message', { cause: error })
}
```

### Logging

Use structured logging:

```typescript
logger.info({ userId, action }, 'User action completed')
logger.error({ error, context }, 'Operation failed')
```

### Comments

- Write self-documenting code
- Add comments for complex logic
- Use JSDoc for public APIs
- Explain "why" not "what"

**Example:**
```typescript
/**
 * Calculate LRU score for cache entry
 * Uses frequency and recency to determine eviction priority
 * 
 * @param entry - Cache entry to score
 * @returns Score (higher = keep longer)
 */
function calculateLRUScore(entry: CacheEntry): number {
  // Implementation
}
```

## Documentation

### Code Documentation

- Add JSDoc comments to all public functions
- Document parameters and return types
- Include usage examples for complex APIs

### User Documentation

- Update README.md for user-facing changes
- Add troubleshooting entries
- Update API documentation
- Include screenshots for UI changes

### Architecture Documentation

- Document design decisions
- Update architecture diagrams
- Explain trade-offs

## Development Workflow

### Typical Workflow

1. **Pick an issue:**
   - Check open issues
   - Comment to claim it
   - Ask questions if unclear

2. **Create branch:**
   ```bash
   git checkout -b feature/your-feature
   ```

3. **Make changes:**
   - Write code
   - Add tests
   - Update docs

4. **Test locally:**
   ```bash
   npm run build
   npm test
   npm run lint
   ```

5. **Commit changes:**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

6. **Push and create PR:**
   ```bash
   git push origin feature/your-feature
   ```

### Getting Help

- **Questions:** Open a discussion on GitHub
- **Bugs:** Open an issue with reproduction steps
- **Chat:** Join our Discord server
- **Email:** dev@hexmon.com

## Release Process

### Versioning

We use [Semantic Versioning](https://semver.org/):
- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes

### Release Checklist

- [ ] All tests pass
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped in package.json
- [ ] Git tag created
- [ ] Release notes written
- [ ] Packages built and tested
- [ ] Published to release channels

## Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Mentioned in release notes
- Credited in documentation

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.

## Questions?

Feel free to reach out:
- GitHub Discussions
- Discord: https://discord.gg/hexmon
- Email: dev@hexmon.com

Thank you for contributing! 🎉

---

**Last Updated:** 2025-01-05

