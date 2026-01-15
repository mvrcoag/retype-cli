import { Command } from "commander";
import Table from "cli-table3";
import { searchService, SearchOptions } from "../../services/search.service.js";
import { referencesService } from "../../services/references.service.js";
import { logger } from "../../utils/logger.js";
import { navigateEntities } from "../../utils/navigator.js";
import { EntityKind } from "../../types/index.js";
import { ENTITY_KINDS } from "../../constants/index.js";

export function createReferencesCommand(): Command {
  const command = new Command("references")
    .alias("refs")
    .description("Find references to entities in the codebase")
    .argument("<name>", "Name or pattern to search for")
    .option("-k, --kind <kind>", `Entity kind: ${ENTITY_KINDS.join(", ")}`)
    .option("-f, --file <path>", "Filter by file path")
    .option("-e, --exported", "Only show exported entities")
    .option("-r, --regex", "Treat name as regex pattern")
    .option("-l, --list", "Show as simple list without navigation")
    .option("-a, --all", "Show all references (no limit)")
    .action(async (name: string, options) => {
      await executeReferences(name, options);
    });

  return command;
}

async function executeReferences(
  name: string,
  options: {
    kind?: string;
    file?: string;
    exported?: boolean;
    regex?: boolean;
    list?: boolean;
    all?: boolean;
  }
): Promise<void> {
  logger.startSpinner("Searching for entities...");

  try {
    const searchOptions: SearchOptions = { name };

    if (options.kind) {
      if (!ENTITY_KINDS.includes(options.kind as EntityKind)) {
        logger.failSpinner(`Invalid kind: ${options.kind}`);
        logger.errorLog(`Valid kinds: ${ENTITY_KINDS.join(", ")}`);
        return;
      }
      searchOptions.kind = options.kind as EntityKind;
    }

    if (options.file) {
      searchOptions.file = options.file;
    }

    if (options.exported) {
      searchOptions.exported = true;
    }

    if (options.regex) {
      searchOptions.regex = true;
    }

    const result = searchService.search(searchOptions);

    if (result.entities.length === 0) {
      logger.failSpinner(`No entities found matching "${name}"`);
      return;
    }

    logger.succeedSpinner(`Found ${result.entities.length} matching entities`);

    let entitiesToAnalyze = result.entities;

    if (result.entities.length > 1 && !options.list) {
      logger.newLine();
      logger.infoLog("Multiple matches found. Select entities to analyze:");
      logger.newLine();

      const navResult = await navigateEntities({
        items: result.entities,
        showBody: false,
        multiSelect: true,
        title: "Select entities to find references",
      });

      if (navResult.cancelled || navResult.selected.length === 0) {
        logger.infoLog("Operation cancelled");
        return;
      }

      entitiesToAnalyze = navResult.selected;
    }

    logger.newLine();

    for (const entity of entitiesToAnalyze) {
      const relativePath = entity.filePath.split("/").slice(-2).join("/");
      logger.log(
        logger.bold("Entity: ") +
          logger.entityIcon(entity.kind) +
          ` ${logger.primary(entity.name)} ` +
          logger.muted(`(${relativePath}:${entity.line})`)
      );

      logger.startSpinner("Analyzing references...");
      const refs = referencesService.findEntityReferences(entity);
      logger.succeedSpinner(`Found ${refs.referencedIn.length} references`);

      if (refs.referencedIn.length === 0) {
        logger.infoLog("No references found for this entity");
        logger.newLine();
        continue;
      }

      logger.newLine();

      if (options.list) {
        displayListResults(refs.referencedIn, options.all);
      } else {
        displayTableResults(refs.referencedIn, options.all);
      }

      logger.newLine();
    }
  } catch (error) {
    logger.failSpinner("References search failed");
    logger.errorLog(error instanceof Error ? error.message : String(error));
  }
}

function displayTableResults(
  references: { file: string; line: number; text: string }[],
  showAll?: boolean
): void {
  const table = new Table({
    head: [logger.bold("File"), logger.bold("Line"), logger.bold("Usage")],
    style: { head: [], border: [] },
    colWidths: [40, 8, 45],
    wordWrap: true,
  });

  const limit = showAll ? references.length : 15;
  for (const ref of references.slice(0, limit)) {
    const refPath = ref.file.split("/").slice(-2).join("/");
    table.push([
      logger.muted(refPath),
      logger.muted(String(ref.line)),
      ref.text.length > 40 ? ref.text.substring(0, 40) + "..." : ref.text,
    ]);
  }

  console.log(table.toString());

  if (!showAll && references.length > 15) {
    logger.log(
      logger.muted(`... and ${references.length - 15} more references (use --all to see all)`)
    );
  }
}

function displayListResults(
  references: { file: string; line: number; text: string }[],
  showAll?: boolean
): void {
  const limit = showAll ? references.length : 15;
  for (const ref of references.slice(0, limit)) {
    const relativePath = ref.file.split("/").slice(-2).join("/");
    console.log(
      `${logger.muted(`${relativePath}:${ref.line}`)} ${ref.text.length > 60 ? ref.text.substring(0, 60) + "..." : ref.text}`
    );
  }

  if (!showAll && references.length > 15) {
    logger.log(
      logger.muted(`... and ${references.length - 15} more references (use --all to see all)`)
    );
  }
}
