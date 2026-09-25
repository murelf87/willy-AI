// Punto único de entrada a los servicios. La interfaz importa siempre desde aquí,
// de modo que conectar un backend consiste en cambiar la implementación, no la UI.

export { projectService, localProjectService, useProjects, useVersions, type ProjectService } from "./project-service";
export { aiService, PROVIDERS, type AIProvider, type ProviderId } from "./ai-service";
export { authService, localAuthService, useSession, type AuthService } from "./auth-service";
export { fileService, type FileService, type CheckIssue } from "./file-service";
export { useFlags, readFlags, setFlag, DEFAULT_FLAGS, type Flags } from "./flags";
export {
  api, attempt, health, backendOn, readBackend, saveBackend, useBackend,
  listOrganizations, refreshData, DEFAULT_BACKEND, ApiError,
  type BackendConfig, type Organization,
} from "./backend";
export { apiAuthService, ApiAuthService } from "./api-auth-service";
export { previewService, type PreviewState, type PreviewStatus } from "./api-preview-service";
export { chatService, type ApiConversation, type ApiMessage } from "./api-chat-service";
export { fetchProjectFiles } from "./api-project-service";
export * as site from "./theme-service";
