import { Project, SourceFile } from "ts-morph";
import * as path from "path";
import * as fs from "fs";
import { ProjectConfig } from "../types/index.js";
import { DEFAULT_EXCLUDE_PATTERNS } from "../constants/index.js";

export class ProjectManager {
  private project: Project;
  private config: ProjectConfig;

  constructor(config: ProjectConfig) {
    this.config = config;

    const tsConfigPath = config.tsConfigPath
      ? path.resolve(config.rootPath, config.tsConfigPath)
      : this.findTsConfig(config.rootPath);

    if (tsConfigPath && fs.existsSync(tsConfigPath)) {
      this.project = new Project({
        tsConfigFilePath: tsConfigPath,
        skipAddingFilesFromTsConfig: false,
      });
    } else {
      this.project = new Project({
        compilerOptions: {
          allowJs: true,
          declaration: false,
          emitDeclarationOnly: false,
        },
      });

      const includePatterns = config.include || ["**/*.ts", "**/*.tsx"];
      const excludePatterns = config.exclude || DEFAULT_EXCLUDE_PATTERNS;

      this.project.addSourceFilesAtPaths(
        includePatterns.map((p) => path.join(config.rootPath, p))
      );

      const sourceFiles = this.project.getSourceFiles();
      for (const file of sourceFiles) {
        const filePath = file.getFilePath();
        if (excludePatterns.some((pattern) => this.matchesPattern(filePath, pattern))) {
          this.project.removeSourceFile(file);
        }
      }
    }
  }

  private findTsConfig(rootPath: string): string | undefined {
    const tsConfigPath = path.join(rootPath, "tsconfig.json");
    if (fs.existsSync(tsConfigPath)) {
      return tsConfigPath;
    }
    return undefined;
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\//g, "\\/");
    return new RegExp(regexPattern).test(filePath);
  }

  getProject(): Project {
    return this.project;
  }

  getSourceFiles(): SourceFile[] {
    return this.project.getSourceFiles();
  }

  getSourceFile(filePath: string): SourceFile | undefined {
    return this.project.getSourceFile(filePath);
  }

  addSourceFile(filePath: string, content: string): SourceFile {
    return this.project.createSourceFile(filePath, content, { overwrite: true });
  }

  saveAll(): void {
    this.project.saveSync();
  }

  getRootPath(): string {
    return this.config.rootPath;
  }

  getFileCount(): number {
    return this.project.getSourceFiles().length;
  }
}

let projectInstance: ProjectManager | null = null;

export function initializeProject(config: ProjectConfig): ProjectManager {
  projectInstance = new ProjectManager(config);
  return projectInstance;
}

export function getProjectInstance(): ProjectManager {
  if (!projectInstance) {
    throw new Error("Project not initialized. Call initializeProject first.");
  }
  return projectInstance;
}
