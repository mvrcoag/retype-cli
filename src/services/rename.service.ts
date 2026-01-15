import {
  Node,
  FunctionDeclaration,
  ClassDeclaration,
  VariableDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  EnumDeclaration,
} from "ts-morph";
import { getProjectInstance } from "../core/project.js";
import { Entity, RenameResult } from "../types/index.js";
import { searchService } from "./search.service.js";

type RenameableNode =
  | FunctionDeclaration
  | ClassDeclaration
  | VariableDeclaration
  | InterfaceDeclaration
  | TypeAliasDeclaration
  | EnumDeclaration;

export class RenameService {
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

    // Save changes
    project.saveAll();

    return {
      oldName: entity.name,
      newName,
      filesModified: Array.from(filesModified),
      referencesUpdated,
    };
  }

  renameByName(name: string, newName: string): RenameResult {
    const entity = searchService.findByName(name);

    if (!entity) {
      throw new Error(`Entity "${name}" not found`);
    }

    return this.rename(entity, newName);
  }

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
}

export const renameService = new RenameService();
