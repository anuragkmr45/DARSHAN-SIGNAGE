import { v4 as uuidv4 } from "uuid";

// uuid retains cryptographic randomness on HTTP origins without native UUID support.
export const createUuid = (): string => uuidv4();
