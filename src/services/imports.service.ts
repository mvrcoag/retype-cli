import { DiagnosticCategory } from "ts-morph";
import { getProjectInstance } from "../core/project.js";
import { searchService } from "./search.service.js";
import { Entity } from "../types/index.js";
import { removeExtension, getRelativePath } from "../utils/path.js";

export interface ImportError {
  file: string;
  line: number;
  column: number;
  message: string;
  missingName: string;
}

export interface FixableImport {
  error: ImportError;
  candidates: Entity[];
  selectedCandidate?: Entity;
}

export interface UnfixableImport {
  error: ImportError;
  reason: string;
}

export interface ImportAnalysis {
  fixable: FixableImport[];
  unfixable: UnfixableImport[];
}

export class ImportsService {
  analyzeImportErrors(): ImportAnalysis {
    const project = getProjectInstance();
    const sourceFiles = project.getSourceFiles();
    const fixable: FixableImport[] = [];
    const unfixable: UnfixableImport[] = [];

    for (const sourceFile of sourceFiles) {
      const diagnostics = sourceFile.getPreEmitDiagnostics();

      for (const diagnostic of diagnostics) {
        if (diagnostic.getCategory() !== DiagnosticCategory.Error) continue;

        const message = diagnostic.getMessageText();
        const messageStr = typeof message === "string" ? message : message.getMessageText();

        // Check for "Cannot find name" errors (missing imports)
        const cannotFindMatch = messageStr.match(/Cannot find name '(\w+)'/);
        if (cannotFindMatch) {
          const missingName = cannotFindMatch[1];
          const start = diagnostic.getStart();
          const lineAndCol = start !== undefined
            ? sourceFile.getLineAndColumnAtPos(start)
            : { line: 0, column: 0 };

          const error: ImportError = {
            file: sourceFile.getFilePath(),
            line: lineAndCol.line,
            column: lineAndCol.column,
            message: messageStr,
            missingName,
          };

          // Search for candidates
          const searchResult = searchService.search({ name: missingName });
          const exactMatches = searchResult.entities.filter(
            (e) => e.name === missingName && e.isExported && e.filePath !== sourceFile.getFilePath()
          );

          if (exactMatches.length > 0) {
            fixable.push({ error, candidates: exactMatches });
          } else {
            unfixable.push({
              error,
              reason: `No exported entity named "${missingName}" found in the codebase`,
            });
          }
        }

        // Check for module not found errors
        const moduleNotFoundMatch = messageStr.match(/Cannot find module '([^']+)'/);
        if (moduleNotFoundMatch) {
          const moduleName = moduleNotFoundMatch[1];
          const start = diagnostic.getStart();
          const lineAndCol = start !== undefined
            ? sourceFile.getLineAndColumnAtPos(start)
            : { line: 0, column: 0 };

          unfixable.push({
            error: {
              file: sourceFile.getFilePath(),
              line: lineAndCol.line,
              column: lineAndCol.column,
              message: messageStr,
              missingName: moduleName,
            },
            reason: `Module "${moduleName}" not found - may need to be installed or path corrected`,
          });
        }
      }
    }

    return { fixable, unfixable };
  }

  fixImport(fix: FixableImport): boolean {
    if (!fix.selectedCandidate) {
      if (fix.candidates.length === 1) {
        fix.selectedCandidate = fix.candidates[0];
      } else {
        return false;
      }
    }

    const project = getProjectInstance();
    const sourceFile = project.getSourceFile(fix.error.file);

    if (!sourceFile) return false;

    const candidate = fix.selectedCandidate;
    const relativePath = removeExtension(
      getRelativePath(fix.error.file, candidate.filePath)
    );

    // Check if import already exists for this module
    const existingImport = sourceFile
      .getImportDeclarations()
      .find((i) => i.getModuleSpecifierValue() === relativePath);

    if (existingImport) {
      // Add to existing import if not already there
      const namedImports = existingImport.getNamedImports();
      if (!namedImports.some((ni) => ni.getName() === candidate.name)) {
        existingImport.addNamedImport(candidate.name);
      }
    } else {
      // Add new import declaration
      sourceFile.addImportDeclaration({
        namedImports: [candidate.name],
        moduleSpecifier: relativePath,
      });
    }

    return true;
  }

  fixMultiple(fixes: FixableImport[]): { fixed: number; failed: number } {
    let fixed = 0;
    let failed = 0;

    for (const fix of fixes) {
      if (this.fixImport(fix)) {
        fixed++;
      } else {
        failed++;
      }
    }

    // Save all changes
    const project = getProjectInstance();
    project.saveAll();

    return { fixed, failed };
  }
}

export const importsService = new ImportsService();
