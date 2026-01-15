import { Command } from "commander";
import { searchService, SearchOptions } from "../../services/search.service.js";
import { logger } from "../../utils/logger.js";
import { navigateEntities } from "../../utils/navigator.js";
import { EntityKind } from "../../types/index.js";
import { ENTITY_KINDS } from "../../constants/index.js";

export function createSearchCommand(): Command {
  const command = new Command("search")
    .alias("s")
    .description("Search for entities in the codebase")
    .argument("[name]", "Name or pattern to search for")
    .option("-k, --kind <kind>", `Entity kind: ${ENTITY_KINDS.join(", ")}`)
    .option("-f, --file <path>", "Filter by file path")
    .option("-e, --exported", "Only show exported entities")
    .option("-p, --private", "Only show non-exported entities")
    .option("-r, --regex", "Treat name as regex pattern")
    .option("-b, --body", "Show code body in results")
    .option("-l, --list", "Show as simple list without navigation")
    .action(async (name: string | undefined, options) => {
      await executeSearch(name, options);
    });

  return command;
}

async function executeSearch(
  name: string | undefined,
  options: {
    kind?: string;
    file?: string;
    exported?: boolean;
    private?: boolean;
    regex?: boolean;
    body?: boolean;
    list?: boolean;
  }
): Promise<void> {
  logger.startSpinner("Searching...");

  try {
    const searchOptions: SearchOptions = {};

    if (name) {
      searchOptions.name = name;
    }

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
    } else if (options.private) {
      searchOptions.exported = false;
    }

    if (options.regex) {
      searchOptions.regex = true;
    }

    const result = searchService.search(searchOptions);

    logger.succeedSpinner(
      `Found ${result.entities.length} entities in ${result.totalFiles} files (${result.searchTime.toFixed(2)}ms)`
    );

    if (result.entities.length === 0) {
      logger.infoLog("No entities found matching your criteria");
      return;
    }

    logger.newLine();

    if (options.list) {
      displayListResults(result.entities);
    } else {
      const navResult = await navigateEntities({
        items: result.entities,
        showBody: options.body ?? false,
        multiSelect: false,
        title: "Search Results",
      });

      if (!navResult.cancelled && navResult.selected.length > 0) {
        const entity = navResult.selected[0];
        logger.newLine();
        logger.success(`Selected: ${entity.name}`);
        logger.log(`  ${logger.muted("File:")} ${logger.filePath(entity.filePath)}`);
        logger.log(`  ${logger.muted("Line:")} ${entity.line}`);
      }
    }
  } catch (error) {
    logger.failSpinner("Search failed");
    logger.errorLog(error instanceof Error ? error.message : String(error));
  }
}

function displayListResults(
  entities: ReturnType<typeof searchService.search>["entities"]
): void {
  for (const entity of entities) {
    const relativePath = entity.filePath.split("/").slice(-2).join("/");
    console.log(
      `${logger.entityIcon(entity.kind)} ${logger.primary(entity.name)} ${logger.muted(
        `${relativePath}:${entity.line}`
      )}${entity.isExported ? logger.secondary(" [exported]") : ""}`
    );
  }
}
