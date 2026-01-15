import * as path from "path";
import * as fs from "fs";
import {
  Node,
  FunctionDeclaration,
  ClassDeclaration,
  VariableStatement,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  EnumDeclaration,
  SyntaxKind,
} from "ts-morph";
import { getProjectInstance } from "../core/project.js";
import { Entity, ExtractResult } from "../types/index.js";
import { ensureDirectoryExists, getRelativePath, removeExtension } from "../utils/path.js";

export class ExtractService {
  extract(entity: Entity, targetPath: string): ExtractResult {
    const project = getProjectInstance();
    const absoluteTargetPath = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(project.getRootPath(), targetPath);

    // Ensure target directory exists
    ensureDirectoryExists(absoluteTargetPath);

    const sourceFile = entity.sourceFile;
    const node = entity.node;

    // Get the full text of the entity to extract
    const entityText = this.getFullEntityText(node, entity.name);

    // Get imports that this entity depends on
    const requiredImports = this.getRequiredImports(node, sourceFile);

    // Check if target file exists
    let targetFile = project.getSourceFile(absoluteTargetPath);
    const fileExists = targetFile !== undefined;

    if (fileExists && targetFile) {
      // Append to existing file
      const existingContent = targetFile.getFullText();
      const newContent = this.mergeContent(
        existingContent,
        entityText,
        requiredImports
      );
      targetFile.replaceWithText(newContent);
    } else {
      // Create new file
      const newContent = this.createFileContent(entityText, requiredImports);
      targetFile = project.addSourceFile(absoluteTargetPath, newContent);
    }

    // Update imports in the source file
    const importsUpdated = this.updateSourceFileImports(
      entity,
      absoluteTargetPath
    );

    // Remove entity from source file
    this.removeEntityFromSource(node);

    // Add import in source file (entity is always exported in target)
    this.addImportToSource(sourceFile, entity.name, absoluteTargetPath);

    // Save all changes
    project.saveAll();

    return {
      entityName: entity.name,
      sourcePath: entity.filePath,
      targetPath: absoluteTargetPath,
      importsUpdated,
    };
  }

  private getFullEntityText(node: Node, name: string): string {
    // Get parent statement for variables
    if (Node.isVariableDeclaration(node)) {
      const statement = node.getFirstAncestorByKind(SyntaxKind.VariableStatement);
      if (statement) {
        // Check if statement has multiple declarations
        const declarations = statement.getDeclarations();
        if (declarations.length === 1) {
          let text = statement.getFullText().trim();
          // Always ensure export keyword for extracted entities
          if (!text.startsWith("export ")) {
            text = "export " + text;
          }
          return text;
        } else {
          // Extract just this declaration - always export
          const keyword = statement.getDeclarationKind();
          return `export ${keyword} ${node.getFullText().trim()};`;
        }
      }
    }

    // For other entities, get the full text and always ensure export
    let text = node.getFullText().trim();

    // Always ensure export keyword for extracted entities (so they can be imported)
    if (!text.startsWith("export ")) {
      text = "export " + text;
    }

    return text;
  }

  private getRequiredImports(node: Node, sourceFile: ReturnType<typeof node.getSourceFile>): string[] {
    const imports: string[] = [];
    const sourceImports = sourceFile.getImportDeclarations();

    // Get all identifiers used in the node
    const usedIdentifiers = new Set<string>();
    node.forEachDescendant((descendant) => {
      if (Node.isIdentifier(descendant)) {
        usedIdentifiers.add(descendant.getText());
      }
    });

    // Check which imports are needed
    for (const importDecl of sourceImports) {
      const namedImports = importDecl.getNamedImports();
      const defaultImport = importDecl.getDefaultImport();
      const namespaceImport = importDecl.getNamespaceImport();

      const neededNamed = namedImports.filter((ni) =>
        usedIdentifiers.has(ni.getName())
      );

      const needsDefault =
        defaultImport && usedIdentifiers.has(defaultImport.getText());
      const needsNamespace =
        namespaceImport && usedIdentifiers.has(namespaceImport.getText());

      if (neededNamed.length > 0 || needsDefault || needsNamespace) {
        imports.push(importDecl.getFullText().trim());
      }
    }

    return imports;
  }

  private mergeContent(
    existingContent: string,
    newEntityText: string,
    newImports: string[]
  ): string {
    const lines = existingContent.split("\n");
    let lastImportIndex = -1;

    // Find the last import statement
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith("import ")) {
        lastImportIndex = i;
      }
    }

    // Add new imports that don't already exist
    const existingImportsText = existingContent;
    const importsToAdd = newImports.filter(
      (imp) => !existingImportsText.includes(imp)
    );

    if (importsToAdd.length > 0) {
      if (lastImportIndex >= 0) {
        lines.splice(lastImportIndex + 1, 0, ...importsToAdd);
      } else {
        lines.unshift(...importsToAdd, "");
      }
    }

    // Add the entity at the end
    lines.push("", newEntityText);

    return lines.join("\n");
  }

  private createFileContent(entityText: string, imports: string[]): string {
    const parts: string[] = [];

    if (imports.length > 0) {
      parts.push(imports.join("\n"));
      parts.push("");
    }

    parts.push(entityText);
    parts.push("");

    return parts.join("\n");
  }

  private updateSourceFileImports(
    entity: Entity,
    targetPath: string
  ): string[] {
    const project = getProjectInstance();
    const sourceFiles = project.getSourceFiles();
    const updatedFiles: string[] = [];

    for (const file of sourceFiles) {
      if (file.getFilePath() === entity.filePath) continue;
      if (file.getFilePath() === targetPath) continue;

      const importDeclarations = file.getImportDeclarations();

      for (const importDecl of importDeclarations) {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        const resolvedPath = this.resolveModulePath(
          file.getFilePath(),
          moduleSpecifier
        );

        if (resolvedPath === entity.filePath) {
          const namedImports = importDecl.getNamedImports();
          const hasEntityImport = namedImports.some(
            (ni) => ni.getName() === entity.name
          );

          if (hasEntityImport) {
            // Update the import to point to the new location
            const newModuleSpecifier = removeExtension(
              getRelativePath(file.getFilePath(), targetPath)
            );

            // Remove entity from old import
            const remainingImports = namedImports.filter(
              (ni) => ni.getName() !== entity.name
            );

            if (remainingImports.length === 0) {
              // Update existing import
              importDecl.setModuleSpecifier(newModuleSpecifier);
            } else {
              // Remove from old and add new import
              namedImports
                .find((ni) => ni.getName() === entity.name)
                ?.remove();

              file.addImportDeclaration({
                namedImports: [entity.name],
                moduleSpecifier: newModuleSpecifier,
              });
            }

            updatedFiles.push(file.getFilePath());
          }
        }
      }
    }

    return updatedFiles;
  }

  private resolveModulePath(fromPath: string, moduleSpecifier: string): string {
    if (!moduleSpecifier.startsWith(".")) {
      return moduleSpecifier;
    }

    const dir = path.dirname(fromPath);
    let resolved = path.resolve(dir, moduleSpecifier);

    // Add .ts extension if not present
    if (!resolved.endsWith(".ts") && !resolved.endsWith(".tsx")) {
      if (fs.existsSync(resolved + ".ts")) {
        resolved += ".ts";
      } else if (fs.existsSync(resolved + ".tsx")) {
        resolved += ".tsx";
      } else if (fs.existsSync(path.join(resolved, "index.ts"))) {
        resolved = path.join(resolved, "index.ts");
      }
    }

    return resolved;
  }

  private removeEntityFromSource(node: Node): void {
    if (Node.isVariableDeclaration(node)) {
      const statement = node.getFirstAncestorByKind(SyntaxKind.VariableStatement);
      if (statement) {
        const declarations = statement.getDeclarations();
        if (declarations.length === 1) {
          statement.remove();
        } else {
          node.remove();
        }
      }
    } else if (
      Node.isFunctionDeclaration(node) ||
      Node.isClassDeclaration(node) ||
      Node.isInterfaceDeclaration(node) ||
      Node.isTypeAliasDeclaration(node) ||
      Node.isEnumDeclaration(node)
    ) {
      node.remove();
    }
  }

  private addImportToSource(
    sourceFile: ReturnType<Node["getSourceFile"]>,
    entityName: string,
    targetPath: string
  ): void {
    const relativePath = removeExtension(
      getRelativePath(sourceFile.getFilePath(), targetPath)
    );

    // Check if import already exists
    const existingImport = sourceFile
      .getImportDeclarations()
      .find((i) => i.getModuleSpecifierValue() === relativePath);

    if (existingImport) {
      const namedImports = existingImport.getNamedImports();
      if (!namedImports.some((ni) => ni.getName() === entityName)) {
        existingImport.addNamedImport(entityName);
      }
    } else {
      sourceFile.addImportDeclaration({
        namedImports: [entityName],
        moduleSpecifier: relativePath,
      });
    }
  }
}

export const extractService = new ExtractService();
