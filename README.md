# ReType

```
    ____       ______
   / __ \___  /_  __/_  ______  ___
  / /_/ / _ \  / / / / / / __ \/ _ \
 / _, _/  __/ / / / /_/ / /_/ /  __/
/_/ |_|\___/ /_/  \__, / .___/\___/
                 /____/_/
```

**The TypeScript Refactoring CLI**

ReType is a powerful command-line tool that makes refactoring TypeScript projects fast, safe, and intuitive. Built on top of [ts-morph](https://ts-morph.com/), it provides both interactive and non-interactive modes for searching, renaming, extracting, and analyzing your codebase.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Feature Deep Dive: Rename](#feature-deep-dive-rename)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [Publishing](#publishing)
- [License](#license)

---

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- A TypeScript project with a `tsconfig.json`

### Installation

#### From npm (Recommended)

```bash
# Install globally
npm install -g retype-cli

# Or use with npx (no install required)
npx retype-cli
```

#### From Source

```bash
# Clone the repository
git clone https://github.com/mvrcoag/retype-cli.git
cd retype-cli

# Install dependencies
npm install

# Build the project
npm run build

# Link globally
npm link
```

### Usage

```bash
# Start interactive mode (default)
retype

# Or use specific commands directly
retype search "UserService"
retype rename "oldFunction" "newFunction"
retype refs "MyClass"
retype unused
```

### Basic Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `retype interactive` | `i` | Start interactive mode with vim-like navigation |
| `retype search <name>` | `s` | Search for entities in the codebase |
| `retype rename <old> [new]` | `r` | Rename an entity across all files |
| `retype extract <name> [path]` | `e` | Extract an entity to a new file |
| `retype references <name>` | `refs` | Find all references to an entity |
| `retype unused` | `u` | Find unused entities |
| `retype fix-imports` | `fi` | Find and fix missing imports |

### Global Options

```bash
-p, --path <path>    # Project root path (default: current directory)
-c, --config <path>  # Path to tsconfig.json
-V, --version        # Output version number
-h, --help           # Display help
```

---

## Features

### Search
Find any entity in your codebase by name, kind, or pattern.

```bash
retype search "User"              # Search by name
retype search -k class            # Filter by kind
retype search ".*Service" -r      # Use regex patterns
retype search -e                  # Only exported entities
```

### Rename
Safely rename entities across your entire codebase with automatic reference updates.

```bash
retype rename "OldName" "NewName"
retype rename "handler" -k function
```

### Extract
Move an entity to a different file while automatically updating all imports.

```bash
retype extract "UserService" "./services/user.service.ts"
```

### References
Find all usages of an entity throughout your project.

```bash
retype refs "calculateTotal"
retype refs "Entity" --all        # Show all references (no limit)
retype refs "User.*" -r -l        # Regex + list format
```

### Unused
Detect dead code - entities that are defined but never used.

```bash
retype unused
retype unused -k function         # Only unused functions
retype unused --list              # Simple list output
```

### Fix Imports
Find and fix missing imports across your codebase.

```bash
retype fix-imports                # Interactive mode
retype fi --list                  # Just show errors, don't fix
retype fi --auto                  # Auto-fix single-candidate imports
```

---

## Feature Deep Dive: Rename

The **Rename** feature demonstrates how ReType leverages the TypeScript compiler to perform safe, project-wide refactorings. Let's walk through the actual code that makes this work.

### Step 1: Entity Discovery

When you search for an entity, the `SearchService` iterates through all source files and extracts entities using `extractEntitiesFromFile`:

**`src/services/search.service.ts`**
```typescript
export class SearchService {
  search(options: SearchOptions): SearchResult {
    const startTime = performance.now();
    const project = getProjectInstance();
    const sourceFiles = project.getSourceFiles();
    const allEntities: Entity[] = [];

    for (const sourceFile of sourceFiles) {
      if (options.file) {
        const filePath = sourceFile.getFilePath();
        if (!filePath.includes(options.file)) {
          continue;
        }
      }

      const entities = extractEntitiesFromFile(sourceFile);
      allEntities.push(...entities);
    }

    let filtered = allEntities;

    if (options.name) {
      if (options.regex) {
        const regex = new RegExp(options.name, "i");
        filtered = filtered.filter((e) => regex.test(e.name));
      } else {
        const searchTerm = options.name.toLowerCase();
        filtered = filtered.filter((e) =>
          e.name.toLowerCase().includes(searchTerm)
        );
      }
    }
    // ... kind and exported filters
  }
}
```

The entity extraction happens in `core/entities.ts`, which uses ts-morph to parse the AST:

**`src/core/entities.ts`**
```typescript
export function extractEntitiesFromFile(sourceFile: SourceFile): Entity[] {
  const entities: Entity[] = [];
  const filePath = sourceFile.getFilePath();

  // Functions
  sourceFile.getFunctions().forEach((node) => {
    const name = node.getName();
    if (name) {
      entities.push(createEntity(node, name, "function", filePath, sourceFile));
    }
  });

  // Classes
  sourceFile.getClasses().forEach((node) => {
    const name = node.getName();
    if (name) {
      entities.push(createEntity(node, name, "class", filePath, sourceFile));
    }
  });

  // Variables, Interfaces, Types, Enums...
  // (same pattern for each entity kind)

  return entities;
}
```

Each entity is created with its AST node reference, which is crucial for later operations:

```typescript
function createEntity(
  node: FunctionDeclaration | ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration | EnumDeclaration,
  name: string,
  kind: EntityKind,
  filePath: string,
  sourceFile: SourceFile
): Entity {
  const pos = node.getNameNode()?.getStartLinePos() ?? node.getStartLinePos();
  const lineAndCol = sourceFile.getLineAndColumnAtPos(pos);

  return {
    name,
    kind,
    filePath,
    line: lineAndCol.line,
    column: lineAndCol.column,
    isExported: node.isExported(),
    node,        // <-- The ts-morph AST node reference
    sourceFile,
  };
}
```

### Step 2: Reference Analysis

Before renaming, ReType shows you all the places that will be affected. This uses ts-morph's powerful `findReferences()` API:

**`src/services/rename.service.ts`**
```typescript
previewRename(entity: Entity): { file: string; line: number; text: string }[] {
  const node = entity.node as RenameableNode;
  const references = this.findReferences(node);

  return references.map((ref) => {
    const sourceFile = ref.getSourceFile();
    const line = sourceFile.getLineAndColumnAtPos(ref.getStart()).line;
    const lineText = sourceFile.getFullText().split("\n")[line - 1] || "";

    return {
      file: sourceFile.getFilePath(),
      line,
      text: lineText.trim(),
    };
  });
}

private findReferences(node: RenameableNode): Node[] {
  const references: Node[] = [];

  if (!this.isRenameable(node)) {
    return references;
  }

  const referencedSymbols = node.findReferences();

  for (const referencedSymbol of referencedSymbols) {
    for (const reference of referencedSymbol.getReferences()) {
      references.push(reference.getNode());
    }
  }

  return references;
}
```

### Step 3: Safe Rename Execution

The actual rename uses ts-morph's built-in `rename()` method, which handles all the complexity of updating references across files:

**`src/services/rename.service.ts`**
```typescript
rename(entity: Entity, newName: string): RenameResult {
  const project = getProjectInstance();
  const filesModified = new Set<string>();
  let referencesUpdated = 0;

  const node = entity.node as RenameableNode;

  // Get all references before renaming
  const references = this.findReferences(node);

  // Track files that will be modified
  for (const ref of references) {
    filesModified.add(ref.getSourceFile().getFilePath());
  }

  // Rename using ts-morph's built-in rename
  if (this.isRenameable(node)) {
    node.rename(newName);
    referencesUpdated = references.length;
  }

  // Save changes to disk
  project.saveAll();

  return {
    oldName: entity.name,
    newName,
    filesModified: Array.from(filesModified),
    referencesUpdated,
  };
}
```

The `isRenameable` check ensures we only attempt to rename nodes that support it:

```typescript
private isRenameable(node: Node): node is RenameableNode {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isClassDeclaration(node) ||
    Node.isVariableDeclaration(node) ||
    Node.isInterfaceDeclaration(node) ||
    Node.isTypeAliasDeclaration(node) ||
    Node.isEnumDeclaration(node)
  );
}
```

### The Complete Flow

```
User runs: retype rename "UserService" "AccountService"
                           │
                           ▼
         ┌─────────────────────────────────────┐
         │  SearchService.search()             │
         │  └─> extractEntitiesFromFile()      │
         │      └─> sourceFile.getClasses()    │
         │          └─> createEntity(node)     │
         └─────────────────────────────────────┘
                           │
                           ▼
         ┌─────────────────────────────────────┐
         │  RenameService.previewRename()      │
         │  └─> findReferences(node)           │
         │      └─> node.findReferences()      │  ← ts-morph API
         │          └─> Returns all usages     │
         └─────────────────────────────────────┘
                           │
                           ▼
         ┌─────────────────────────────────────┐
         │  RenameService.rename()             │
         │  └─> node.rename("AccountService")  │  ← ts-morph API
         │  └─> project.saveAll()              │
         │      └─> Writes all modified files  │
         └─────────────────────────────────────┘
                           │
                           ▼
         ┌─────────────────────────────────────┐
         │  RenameResult                       │
         │  {                                  │
         │    oldName: "UserService",          │
         │    newName: "AccountService",       │
         │    filesModified: [...],            │
         │    referencesUpdated: 12            │
         │  }                                  │
         └─────────────────────────────────────┘
```

### Example Session

```bash
$ retype rename "fetchUser" "getUserById" -k function

╭──────────────────────────────────────────────────────────╮
│                                                          │
│   ReType v1.0.0                                          │
│   The TypeScript Refactoring CLI - @mvrcoag              │
│                                                          │
╰──────────────────────────────────────────────────────────╯

✔ Loaded 47 source files

✔ Found 1 matching entities

Entity: fn fetchUser (api/users.ts:23)

Analyzing references...
✔ Found 8 references

References to be updated:

┌───────────────────────────────┬──────┬──────────────────────────────┐
│ File                          │ Line │ Code                         │
├───────────────────────────────┼──────┼──────────────────────────────┤
│ api/users.ts                  │ 23   │ export async function fetch  │
│ controllers/user.controller   │ 15   │ const user = await fetchUser │
│ hooks/useUser.ts              │ 8    │ import { fetchUser } from .. │
│ hooks/useUser.ts              │ 22   │ return fetchUser(userId);    │
└───────────────────────────────┴──────┴──────────────────────────────┘
... and 4 more references

? Rename "fetchUser" → "getUserById"? (Y/n) y

✔ Renamed "fetchUser" → "getUserById" (8 references)
```

---

## Architecture

ReType follows a layered architecture that separates concerns between CLI interaction, business logic, and TypeScript AST manipulation.

```
┌─────────────────────────────────────────────────────────────────────┐
│                            CLI Layer                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Interactive    │  │   Commands      │  │     Utilities       │  │
│  │  (index.ts)     │  │   (commands/)   │  │  logger, prompts,   │  │
│  │                 │  │                 │  │  navigator          │  │
│  │  - mainMenu()   │  │  - search.ts    │  │                     │  │
│  │  - vimSelect()  │  │  - rename.ts    │  │                     │  │
│  │  - vimInput()   │  │  - extract.ts   │  │                     │  │
│  │                 │  │  - unused.ts    │  │                     │  │
│  │                 │  │  - references.ts│  │                     │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │
└───────────┼─────────────────────┼─────────────────────┼─────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Service Layer                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ SearchService   │  │ RenameService   │  │ ReferencesService   │  │
│  │                 │  │                 │  │                     │  │
│  │ - search()      │  │ - rename()      │  │ - findEntity        │  │
│  │ - findByName()  │  │ - previewRename │  │   References()      │  │
│  │ - findByKind()  │  │ - renameByName()│  │ - findFileRefs()    │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │
│           │                    │                      │             │
│  ┌────────┴────────┐  ┌────────┴────────┐             │             │
│  │ ExtractService  │  │ UnusedService   │             │             │
│  │                 │  │                 │             │             │
│  │ - extract()     │  │ - findUnused()  │             │             │
│  │ - updateImports │  │ - analyzeUsage  │             │             │
│  └────────┬────────┘  └────────┬────────┘             │             │
└───────────┼─────────────────────┼─────────────────────┼─────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Core Layer                                 │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐   │
│  │      ProjectManager         │  │       Entity Extraction     │   │
│  │      (project.ts)           │  │       (entities.ts)         │   │
│  │                             │  │                             │   │
│  │  - initializeProject()      │  │  - extractEntitiesFromFile  │   │
│  │  - getSourceFiles()         │  │  - getEntityKind()          │   │
│  │  - saveAll()                │  │  - isExported()             │   │
│  └──────────────┬──────────────┘  └──────────────┬──────────────┘   │
└─────────────────┼────────────────────────────────┼──────────────────┘
                  │                                │
                  ▼                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         ts-morph                                    │
│                                                                     │
│   TypeScript AST manipulation, symbol resolution, file management   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
src/
├── cli/
│   ├── index.ts              # Main entry, interactive mode
│   └── commands/             # Non-interactive commands
│       ├── search.ts
│       ├── rename.ts
│       ├── extract.ts
│       ├── unused.ts
│       └── references.ts
├── services/
│   ├── search.service.ts     # Entity search logic
│   ├── rename.service.ts     # Rename operations
│   ├── extract.service.ts    # Entity extraction
│   ├── unused.service.ts     # Dead code detection
│   ├── references.service.ts # Reference finding
│   └── index.ts
├── core/
│   ├── project.ts            # ProjectManager (ts-morph wrapper)
│   ├── entities.ts           # Entity extraction from AST
│   └── index.ts
├── types/
│   └── index.ts              # TypeScript interfaces
├── utils/
│   ├── logger.ts             # Colored output, spinners
│   ├── prompts.ts            # Vim-like interactive prompts
│   ├── navigator.ts          # Entity navigation UI
│   └── path.ts               # Path utilities
├── constants/
│   └── index.ts              # App constants, icons, colors
└── index.ts                  # Library exports
```

### Key Concepts

**Entity**: A searchable/refactorable code element:
- Functions
- Classes
- Variables
- Interfaces
- Types
- Enums

**ProjectManager**: Wraps ts-morph's `Project` class, handles:
- tsconfig.json detection and loading
- Source file management
- File exclusion patterns (node_modules, dist, etc.)

**Services**: Stateless classes that perform specific refactoring operations using the Core layer.

---

## Contributing

Contributions are welcome! Here's how you can help:

### Development Setup

```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/retype-cli.git
cd retype-cli

# Install dependencies
npm install

# Start development mode (watch for changes)
npm run dev

# In another terminal, test your changes
node dist/cli/index.js
```

### Project Scripts

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode compilation
npm run start    # Run the CLI
npm run lint     # Run ESLint
```

### Guidelines

1. **Code Style**
   - Follow existing patterns in the codebase
   - Use TypeScript strict mode
   - Keep functions small and focused

2. **Commits**
   - Write clear, descriptive commit messages
   - Reference issues when applicable

3. **Pull Requests**
   - Create a feature branch from `main`
   - Add tests for new functionality
   - Update documentation if needed
   - Ensure all checks pass

### Adding a New Command

1. Create the service in `src/services/`:
   ```typescript
   // src/services/myfeature.service.ts
   export class MyFeatureService {
     doSomething(entity: Entity): Result { ... }
   }
   export const myFeatureService = new MyFeatureService();
   ```

2. Create the CLI command in `src/cli/commands/`:
   ```typescript
   // src/cli/commands/myfeature.ts
   export function createMyFeatureCommand(): Command {
     return new Command("myfeature")
       .description("...")
       .action(async () => { ... });
   }
   ```

3. Register the command in `src/cli/index.ts`:
   ```typescript
   import { createMyFeatureCommand } from "./commands/myfeature.js";
   program.addCommand(createMyFeatureCommand());
   ```

4. Add interactive mode support in the `mainMenu()` function.

### Reporting Issues

- Use the GitHub issue tracker
- Include reproduction steps
- Provide TypeScript/Node.js version info
- Attach relevant code snippets or error messages

---

## Publishing

### CI/CD Pipeline

This project uses GitHub Actions for continuous integration and automatic publishing:

- **CI Workflow**: Runs on every push and PR to `main`, testing against Node.js 18, 20, and 22
- **Publish Workflow**: Automatically publishes to npm when the version in `package.json` changes

### Initial Setup (Maintainers)

#### 1. First Manual Publish

Before setting up automation, publish the first version manually:

```bash
npm login
npm publish --access public
```

#### 2. Create npm Access Token

1. Go to https://www.npmjs.com/settings/YOUR_USERNAME/tokens
2. Click **"Generate New Token"** → **"Granular Access Token"**
3. Configure:
   - **Token name**: `GitHub Actions - retype-cli`
   - **Expiration**: No expiration (or set reminder to rotate)
   - **Packages and scopes**: Read and write
   - **Select packages**: Choose `retype-cli`
   - **Advanced** → Uncheck "Require two-factor authentication" (for CI/CD)
4. Click **"Generate token"** and copy it

#### 3. Add Token to GitHub Secrets

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **"New repository secret"**
3. Name: `NPM_TOKEN`
4. Value: (paste your npm token)
5. Click **"Add secret"**

### Releasing New Versions

After the initial setup, releasing is simple:

```bash
# Update version (automatically commits and creates a git tag)
npm version patch   # 1.1.0 → 1.1.1 (bug fixes)
npm version minor   # 1.1.0 → 1.2.0 (new features)
npm version major   # 1.1.0 → 2.0.0 (breaking changes)

# Push to trigger automatic publish
git push && git push --tags
```

The workflow will:
1. Detect the version change
2. Build and publish to npm
3. Create a GitHub Release with auto-generated release notes

### Manual Publishing

If needed, you can still publish manually:

```bash
npm run build
npm publish
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with <code>ts-morph</code> by <a href="https://github.com/mvrcoag">@mvrcoag</a>
</p>
