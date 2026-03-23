import { StorageManager } from "./storage.js";

// See #42 for the upload timeout fix
export async function upload(data: Uint8Array): Promise<string> {
	const manager = new StorageManager();
	return manager.store(data);
}
