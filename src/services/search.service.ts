import { getProjectInstance } from "../core/project.js";
import { extractEntitiesFromFile } from "../core/entities.js";
import { Entity, EntityKind, SearchResult } from "../types/index.js";

export interface SearchOptions {
  name?: string;
  kind?: EntityKind;
  exported?: boolean;
  file?: string;
  regex?: boolean;
}

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

    if (options.kind) {
      filtered = filtered.filter((e) => e.kind === options.kind);
    }

    if (options.exported !== undefined) {
      filtered = filtered.filter((e) => e.isExported === options.exported);
    }

    const endTime = performance.now();

    return {
      entities: filtered,
      totalFiles: sourceFiles.length,
      searchTime: endTime - startTime,
    };
  }

  findByName(name: string, kind?: EntityKind): Entity | undefined {
    const result = this.search({ name, kind });
    return result.entities.find((e) => e.name === name);
  }

  findAllByKind(kind: EntityKind): Entity[] {
    return this.search({ kind }).entities;
  }

  findInFile(filePath: string): Entity[] {
    return this.search({ file: filePath }).entities;
  }

  getEntityDetails(entity: Entity): Record<string, unknown> {
    const details: Record<string, unknown> = {
      name: entity.name,
      kind: entity.kind,
      file: entity.filePath,
      line: entity.line,
      column: entity.column,
      exported: entity.isExported,
    };

    return details;
  }
}

export const searchService = new SearchService();
