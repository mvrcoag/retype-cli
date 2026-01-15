import {
  SourceFile,
  FunctionDeclaration,
  ClassDeclaration,
  VariableDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  EnumDeclaration,
  Node,
  SyntaxKind,
} from "ts-morph";
import { Entity, EntityKind } from "../types/index.js";

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

  // Variables (top-level const/let/var)
  sourceFile.getVariableStatements().forEach((statement) => {
    statement.getDeclarations().forEach((node) => {
      const name = node.getName();
      entities.push(
        createEntityFromVariable(
          node,
          name,
          filePath,
          sourceFile,
          statement.isExported()
        )
      );
    });
  });

  // Interfaces
  sourceFile.getInterfaces().forEach((node) => {
    const name = node.getName();
    entities.push(createEntity(node, name, "interface", filePath, sourceFile));
  });

  // Type aliases
  sourceFile.getTypeAliases().forEach((node) => {
    const name = node.getName();
    entities.push(createEntity(node, name, "type", filePath, sourceFile));
  });

  // Enums
  sourceFile.getEnums().forEach((node) => {
    const name = node.getName();
    entities.push(createEntity(node, name, "enum", filePath, sourceFile));
  });

  return entities;
}

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
    node,
    sourceFile,
  };
}

function createEntityFromVariable(
  node: VariableDeclaration,
  name: string,
  filePath: string,
  sourceFile: SourceFile,
  isExported: boolean
): Entity {
  const pos = node.getNameNode().getStartLinePos();
  const lineAndCol = sourceFile.getLineAndColumnAtPos(pos);

  return {
    name,
    kind: "variable",
    filePath,
    line: lineAndCol.line,
    column: lineAndCol.column,
    isExported,
    node,
    sourceFile,
  };
}

export function getEntityKindFromNode(node: Node): EntityKind | null {
  switch (node.getKind()) {
    case SyntaxKind.FunctionDeclaration:
      return "function";
    case SyntaxKind.ClassDeclaration:
      return "class";
    case SyntaxKind.VariableDeclaration:
      return "variable";
    case SyntaxKind.InterfaceDeclaration:
      return "interface";
    case SyntaxKind.TypeAliasDeclaration:
      return "type";
    case SyntaxKind.EnumDeclaration:
      return "enum";
    default:
      return null;
  }
}

export function findEntityByName(
  entities: Entity[],
  name: string,
  kind?: EntityKind
): Entity | undefined {
  return entities.find(
    (e) => e.name === name && (kind === undefined || e.kind === kind)
  );
}
