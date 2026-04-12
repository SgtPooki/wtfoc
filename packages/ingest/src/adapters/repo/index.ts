export { RepoAdapter, type RepoAdapterConfig, type RepoIngestMetadata } from "./adapter.js";
export {
	type ChangedFile,
	commitExists,
	type FileChangeStatus,
	getChangedFiles,
	getHeadCommit,
	isGitRepo,
} from "./git-diff.js";
