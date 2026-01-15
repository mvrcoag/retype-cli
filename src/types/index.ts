import { SourceFile, Node } from "ts-morph";

export type EntityKind =
  | "function"
  | "class"
  | "variable"
  | "interface"
  | "type"
  | "enum";

export interface Entity {
  name: string;
  kind: EntityKind;
  filePath: string;
  line: number;
  column: number;
  isExported: boolean;
  node: Node;
  sourceFile: SourceFile;
}

export interface SearchResult {
  entities: Entity[];
  totalFiles: number;
  searchTime: number;
}

export interface RenameResult {
  oldName: string;
  newName: string;
  filesModified: string[];
  referencesUpdated: number;
}

export interface ExtractResult {
  entityName: string;
  sourcePath: string;
  targetPath: string;
  importsUpdated: string[];
}

export interface UnusedResult {
  entity: Entity;
  reason: string;
}

export interface ProjectConfig {
  rootPath: string;
  tsConfigPath?: string;
  include?: string[];
  exclude?: string[];
}
