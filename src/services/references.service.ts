import * as path from "path";
import { getProjectInstance } from "../core/project.js";
import { Entity } from "../types/index.js";
import { extractEntitiesFromFile } from "../core/entities.js";

export interface FileReference {
  fromFile: string;
  toFile: string;
  importStatement: string;
  line: number;
}

export interface EntityReference {
  entity: Entity;
  referencedIn: {
    file: string;
    line: number;
    text: string;
  }[];
}

export class ReferencesService {
  findFileReferences(filePath: string): FileReference[] {
    const project = getProjectInstance();
    const sourceFiles = project.getSourceFiles();
    const references: FileReference[] = [];

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(project.getRootPath(), filePath);

    for (const sourceFile of sourceFiles) {
      if (sourceFile.getFilePath() === absolutePath) continue;

      const imports = sourceFile.getImportDeclarations();

      for (const importDecl of imports) {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();

        if (moduleSpecifier.startsWith(".")) {
          const resolvedPath = this.resolveImportPath(
            sourceFile.getFilePath(),
            moduleSpecifier
          );

          if (resolvedPath === absolutePath) {
            references.push({
              fromFile: sourceFile.getFilePath(),
              toFile: absolutePath,
              importStatement: importDecl.getText(),
              line: sourceFile.getLineAndColumnAtPos(importDecl.getStart()).line,
            });
          }
        }
      }
    }

    return references;
  }

  findEntityReferences(entity: Entity): EntityReference {
    const references: EntityReference["referencedIn"] = [];

    try {
      const node = entity.node;

      if (
        "findReferences" in node &&
        typeof node.findReferences === "function"
      ) {
        const referencedSymbols = node.findReferences();

        for (const referencedSymbol of referencedSymbols) {
          for (const reference of referencedSymbol.getReferences()) {
            const refNode = reference.getNode();
            const refSourceFile = refNode.getSourceFile();
            const refFilePath = refSourceFile.getFilePath();
            const refLine = refSourceFile.getLineAndColumnAtPos(refNode.getStart()).line;

            if (
              refFilePath === entity.filePath &&
              Math.abs(refLine - entity.line) < 3
            ) {
              continue;
            }

            const lineText = refSourceFile.getFullText().split("\n")[refLine - 1] || "";

            references.push({
              file: refFilePath,
              line: refLine,
              text: lineText.trim(),
            });
          }
        }
      }
    } catch {
      // Silently handle errors
    }

    return {
      entity,
      referencedIn: references,
    };
  }

  findAllReferencesToFile(filePath: string): {
    imports: FileReference[];
    entities: EntityReference[];
  } {
    const project = getProjectInstance();
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(project.getRootPath(), filePath);

    const sourceFile = project.getSourceFile(absolutePath);

    if (!sourceFile) {
      return { imports: [], entities: [] };
    }

    const imports = this.findFileReferences(absolutePath);
    const entities = extractEntitiesFromFile(sourceFile);
    const entityRefs: EntityReference[] = [];

    for (const entity of entities) {
      if (entity.isExported) {
        const refs = this.findEntityReferences(entity);
        if (refs.referencedIn.length > 0) {
          entityRefs.push(refs);
        }
      }
    }

    return {
      imports,
      entities: entityRefs,
    };
  }

  private resolveImportPath(fromPath: string, moduleSpecifier: string): string {
    const dir = path.dirname(fromPath);
    let resolved = path.resolve(dir, moduleSpecifier);

    const extensions = [".ts", ".tsx", ".js", ".jsx"];

    for (const ext of extensions) {
      if (resolved.endsWith(ext)) {
        return resolved;
      }
    }

    const project = getProjectInstance();

    for (const ext of extensions) {
      const withExt = resolved + ext;
      if (project.getSourceFile(withExt)) {
        return withExt;
      }
    }

    for (const ext of extensions) {
      const indexPath = path.join(resolved, `index${ext}`);
      if (project.getSourceFile(indexPath)) {
        return indexPath;
      }
    }

    return resolved + ".ts";
  }
}

export const referencesService = new ReferencesService();
