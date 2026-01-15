import { Command } from "commander";
import Table from "cli-table3";
import { unusedService } from "../../services/unused.service.js";
import { logger } from "../../utils/logger.js";

export function createUnusedCommand(): Command {
  const command = new Command("unused")
    .alias("u")
    .description("Find unused entities in the codebase")
    .option("-e, --exported", "Only show unused exports")
    .option("-p, --private", "Only show unused private entities")
    .option("-s, --stats", "Show statistics only")
    .action(async (options) => {
      await executeUnused(options);
    });

  return command;
}

async function executeUnused(options: {
  exported?: boolean;
  private?: boolean;
  stats?: boolean;
}): Promise<void> {
  logger.startSpinner("Analyzing codebase for unused entities...");

  try {
    if (options.stats) {
      const stats = unusedService.getUnusedStats();

      logger.succeedSpinner("Analysis complete");
      logger.newLine();

      logger.box(
        "Unused Entities Statistics",
        `${logger.muted("Total unused:")} ${logger.warning(String(stats.total))}\n` +
          `${logger.muted("Exported:")} ${stats.exported}\n` +
          `${logger.muted("Private:")} ${stats.private}\n\n` +
          `${logger.bold("By kind:")}\n` +
          Object.entries(stats.byKind)
            .map(([kind, count]) => `  ${logger.entityIcon(kind)} ${kind}: ${count}`)
            .join("\n")
      );

      return;
    }

    let results;
    if (options.exported) {
      results = unusedService.findUnusedExports();
    } else if (options.private) {
      results = unusedService.findUnusedPrivate();
    } else {
      results = unusedService.findUnused();
    }

    logger.succeedSpinner(`Found ${results.length} unused entities`);

    if (results.length === 0) {
      logger.newLine();
      logger.success("No unused entities found!");
      return;
    }

    logger.newLine();

    const table = new Table({
      head: [
        logger.bold("Type"),
        logger.bold("Name"),
        logger.bold("File"),
        logger.bold("Line"),
        logger.bold("Reason"),
      ],
      style: { head: [], border: [] },
      colWidths: [8, 25, 35, 8, 40],
      wordWrap: true,
    });

    for (const item of results) {
      const relativePath = item.entity.filePath.split("/").slice(-2).join("/");

      table.push([
        logger.entityIcon(item.entity.kind),
        logger.warning(item.entity.name),
        logger.muted(relativePath),
        logger.muted(String(item.entity.line)),
        logger.muted(item.reason),
      ]);
    }

    console.log(table.toString());

    logger.newLine();
    logger.infoLog(
      `Consider removing these ${results.length} unused entities to clean up your codebase`
    );
  } catch (error) {
    logger.failSpinner("Analysis failed");
    logger.errorLog(error instanceof Error ? error.message : String(error));
  }
}
