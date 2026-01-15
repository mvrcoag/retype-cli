import { Command } from "commander";
import { input, confirm } from "@inquirer/prompts";
import { extractService } from "../../services/extract.service.js";
import { searchService } from "../../services/search.service.js";
import { logger } from "../../utils/logger.js";

export function createExtractCommand(): Command {
  const command = new Command("extract")
    .alias("e")
    .description("Extract an entity to a different file")
    .argument("<entityName>", "Name of the entity to extract")
    .argument("[targetPath]", "Target file path")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (entityName: string, targetPath: string | undefined, options) => {
      await executeExtract(entityName, targetPath, options);
    });

  return command;
}

async function executeExtract(
  entityName: string,
  targetPath: string | undefined,
  options: { yes?: boolean }
): Promise<void> {
  logger.startSpinner(`Looking for "${entityName}"...`);

  try {
    const entity = searchService.findByName(entityName);

    if (!entity) {
      logger.failSpinner(`Entity "${entityName}" not found`);
      return;
    }

    logger.succeedSpinner(
      `Found ${entity.kind} "${entity.name}" in ${entity.filePath}`
    );

    let destination = targetPath;
    if (!destination) {
      logger.newLine();
      destination = await input({
        message: "Enter target file path:",
        validate: (value) => {
          if (!value.trim()) {
            return "Path cannot be empty";
          }
          if (!value.endsWith(".ts") && !value.endsWith(".tsx")) {
            return "Path must end with .ts or .tsx";
          }
          return true;
        },
      });
    }

    logger.newLine();
    logger.log(logger.bold("Extraction Plan:"));
    logger.log(`  ${logger.muted("Entity:")} ${logger.primary(entity.name)}`);
    logger.log(`  ${logger.muted("From:")} ${logger.filePath(entity.filePath)}`);
    logger.log(`  ${logger.muted("To:")} ${logger.filePath(destination!)}`);
    logger.newLine();

    if (!options.yes) {
      const shouldProceed = await confirm({
        message: "Proceed with extraction?",
        default: true,
      });

      if (!shouldProceed) {
        logger.infoLog("Operation cancelled");
        return;
      }
    }

    logger.startSpinner("Extracting...");

    const result = extractService.extract(entity, destination!);

    logger.succeedSpinner("Extraction completed successfully");
    logger.newLine();

    logger.box(
      "Extraction Summary",
      `${logger.muted("Entity:")} ${logger.primary(result.entityName)}\n` +
        `${logger.muted("From:")} ${result.sourcePath}\n` +
        `${logger.muted("To:")} ${result.targetPath}\n` +
        `${logger.muted("Imports updated:")} ${result.importsUpdated.length} files`
    );

    if (result.importsUpdated.length > 0) {
      logger.newLine();
      logger.log(logger.bold("Files with updated imports:"));
      for (const file of result.importsUpdated) {
        const relativePath = file.split("/").slice(-2).join("/");
        logger.log(`  ${logger.muted("-")} ${relativePath}`);
      }
    }
  } catch (error) {
    logger.failSpinner("Extraction failed");
    logger.errorLog(error instanceof Error ? error.message : String(error));
  }
}
