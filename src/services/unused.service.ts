import { Node } from "ts-morph";
import { getProjectInstance } from "../core/project.js";
import { extractEntitiesFromFile } from "../core/entities.js";
import { Entity, UnusedResult } from "../types/index.js";

export class UnusedService {
  findUnused(): UnusedResult[] {
    const project = getProjectInstance();
    const sourceFiles = project.getSourceFiles();
    const unusedEntities: UnusedResult[] = [];

    for (const sourceFile of sourceFiles) {
      const entities = extractEntitiesFromFile(sourceFile);

      for (const entity of entities) {
        const unusedCheck = this.checkIfUnused(entity);
        if (unusedCheck.unused) {
          unusedEntities.push({
            entity,
            reason: unusedCheck.reason,
          });
        }
      }
    }

    return unusedEntities;
  }

  findUnusedExports(): UnusedResult[] {
    return this.findUnused().filter((u) => u.entity.isExported);
  }

  findUnusedPrivate(): UnusedResult[] {
    return this.findUnused().filter((u) => !u.entity.isExported);
  }

  private checkIfUnused(entity: Entity): { unused: boolean; reason: string } {
    const node = entity.node;

    // Skip main/index files as they are typically entry points
    if (
      entity.filePath.endsWith("index.ts") ||
      entity.filePath.endsWith("main.ts")
    ) {
      return { unused: false, reason: "" };
    }

    // Get references
    const references = this.getReferences(node);

    // Filter out the definition itself
    const externalReferences = references.filter((ref) => {
      const refFile = ref.getSourceFile().getFilePath();
      const refStart = ref.getStart();
      const nodeStart = node.getStart();

      // Same file and same position = definition
      if (refFile === entity.filePath && Math.abs(refStart - nodeStart) < 10) {
        return false;
      }

      return true;
    });

    if (externalReferences.length === 0) {
      if (entity.isExported) {
        return {
          unused: true,
          reason: "Exported but never imported or used elsewhere",
        };
      } else {
        return {
          unused: true,
          reason: "Not exported and never used in its file",
        };
      }
    }

    // Check if all references are in the same file (for non-exported)
    if (!entity.isExported) {
      const sameFileRefs = externalReferences.filter(
        (ref) => ref.getSourceFile().getFilePath() === entity.filePath
      );

      if (sameFileRefs.length === externalReferences.length) {
        // All references are in the same file - check if they're real usages
        const realUsages = sameFileRefs.filter((ref) => {
          const parent = ref.getParent();
          // Skip if it's the declaration itself
          if (
            parent &&
            (Node.isVariableDeclaration(parent) ||
              Node.isFunctionDeclaration(parent) ||
              Node.isClassDeclaration(parent))
          ) {
            return false;
          }
          return true;
        });

        if (realUsages.length === 0) {
          return {
            unused: true,
            reason: "Declared but never used",
          };
        }
      }
    }

    return { unused: false, reason: "" };
  }

  private getReferences(node: Node): Node[] {
    const references: Node[] = [];

    try {
      // Try to find references using the node's findReferences method
      if (
        Node.isFunctionDeclaration(node) ||
        Node.isClassDeclaration(node) ||
        Node.isVariableDeclaration(node) ||
        Node.isInterfaceDeclaration(node) ||
        Node.isTypeAliasDeclaration(node) ||
        Node.isEnumDeclaration(node)
      ) {
        const referencedSymbols = node.findReferences();

        for (const referencedSymbol of referencedSymbols) {
          for (const reference of referencedSymbol.getReferences()) {
            references.push(reference.getNode());
          }
        }
      }
    } catch {
      // If findReferences fails, return empty array
    }

    return references;
  }

  getUnusedStats(): {
    total: number;
    byKind: Record<string, number>;
    exported: number;
    private: number;
  } {
    const unused = this.findUnused();

    const byKind: Record<string, number> = {};
    let exported = 0;
    let privateCount = 0;

    for (const item of unused) {
      const kind = item.entity.kind;
      byKind[kind] = (byKind[kind] || 0) + 1;

      if (item.entity.isExported) {
        exported++;
      } else {
        privateCount++;
      }
    }

    return {
      total: unused.length,
      byKind,
      exported,
      private: privateCount,
    };
  }
}

export const unusedService = new UnusedService();
