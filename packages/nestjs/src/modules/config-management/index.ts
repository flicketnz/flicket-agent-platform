// Don't export the module from the barrel export - Due to the @Module decorator,
// the module with attempt to init partially during tests - throwing misleading
// errors that are not errors, anytime this barell export is imported - for example,
// when shared types are required.

// export { ConfigManagementModule } from "./config-management.module";
export * from "./types/config.types";
