// Core
export {
  ProjectManager,
  initializeProject,
  getProjectInstance,
} from "./core/project.js";
export { extractEntitiesFromFile, findEntityByName } from "./core/entities.js";

// Services
export { searchService, SearchService } from "./services/search.service.js";
export { renameService, RenameService } from "./services/rename.service.js";
export { extractService, ExtractService } from "./services/extract.service.js";
export { unusedService, UnusedService } from "./services/unused.service.js";

// Types
export type {
  Entity,
  EntityKind,
  SearchResult,
  RenameResult,
  ExtractResult,
  UnusedResult,
  ProjectConfig,
} from "./types/index.js";

// Constants
export {
  APP_NAME,
  APP_VERSION,
  APP_DESCRIPTION,
  APP_AUTHOR,
  ENTITY_KINDS,
  COLORS,
} from "./constants/index.js";

// Utils
export { logger } from "./utils/logger.js";
export * from "./utils/path.js";
