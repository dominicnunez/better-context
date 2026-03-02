import { describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ConfigService } from '../config/index.ts';
import type { ResourcesService } from '../resources/service.ts';
import { createCollectionsService } from './service.ts';
import { disposeVirtualFs, existsInVirtualFs } from '../vfs/virtual-fs.ts';

const createLocalResource = (name: string, resourcePath: string) => ({
	_tag: 'fs-based' as const,
	name,
	fsName: name,
	type: 'local' as const,
	repoSubPaths: [],
	specialAgentInstructions: '',
	getAbsoluteDirectoryPath: async () => resourcePath
});

const createConfigMock = () =>
	({
		getResource: () => undefined
	}) as unknown as ConfigService;

const createResourcesMock = (resourcePath: string) =>
	({
		load: () => {
			throw new Error('Not implemented in test');
		},
		loadPromise: async () => createLocalResource('repo', resourcePath)
	}) as unknown as ResourcesService;

const runGit = (cwd: string, args: string[]) => {
	const result = Bun.spawnSync({
		cmd: ['git', ...args],
		cwd,
		stdout: 'pipe',
		stderr: 'pipe'
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed: ${new TextDecoder().decode(result.stderr).trim()}`
		);
	}
};

const cleanupCollection = async (collection: { vfsId?: string; cleanup?: () => Promise<void> }) => {
	await collection.cleanup?.();
	if (collection.vfsId) disposeVirtualFs(collection.vfsId);
};

describe('createCollectionsService', () => {
	it('imports git-backed local resources from tracked and unignored files only', async () => {
		const resourcePath = await fs.mkdtemp(path.join(os.tmpdir(), 'btca-collections-git-'));
		const collections = createCollectionsService({
			config: createConfigMock(),
			resources: createResourcesMock(resourcePath)
		});

		try {
			await fs.mkdir(path.join(resourcePath, 'node_modules', 'pkg'), { recursive: true });
			await fs.writeFile(path.join(resourcePath, '.gitignore'), 'node_modules\n');
			await fs.writeFile(path.join(resourcePath, 'package.json'), '{"name":"repo"}\n');
			await fs.writeFile(path.join(resourcePath, 'README.md'), 'local notes\n');
			await fs.writeFile(path.join(resourcePath, 'node_modules', 'pkg', 'index.js'), 'ignored\n');

			runGit(resourcePath, ['init', '-q']);
			runGit(resourcePath, ['add', '.gitignore', 'package.json']);

			const collection = await collections.loadPromise({ resourceNames: ['repo'] });

			try {
				expect(await existsInVirtualFs('/repo/package.json', collection.vfsId)).toBe(true);
				expect(await existsInVirtualFs('/repo/README.md', collection.vfsId)).toBe(true);
				expect(await existsInVirtualFs('/repo/node_modules/pkg/index.js', collection.vfsId)).toBe(
					false
				);
				expect(await existsInVirtualFs('/repo/.git/config', collection.vfsId)).toBe(false);
			} finally {
				await cleanupCollection(collection);
			}
		} finally {
			await fs.rm(resourcePath, { recursive: true, force: true });
		}
	});

	it('falls back to directory import and still skips heavy local build directories', async () => {
		const resourcePath = await fs.mkdtemp(path.join(os.tmpdir(), 'btca-collections-local-'));
		const collections = createCollectionsService({
			config: createConfigMock(),
			resources: createResourcesMock(resourcePath)
		});

		try {
			await fs.mkdir(path.join(resourcePath, 'node_modules', 'pkg'), { recursive: true });
			await fs.mkdir(path.join(resourcePath, 'dist'), { recursive: true });
			await fs.writeFile(path.join(resourcePath, 'package.json'), '{"name":"repo"}\n');
			await fs.writeFile(path.join(resourcePath, 'README.md'), 'hello\n');
			await fs.writeFile(path.join(resourcePath, 'node_modules', 'pkg', 'index.js'), 'ignored\n');
			await fs.writeFile(path.join(resourcePath, 'dist', 'bundle.js'), 'ignored\n');

			const collection = await collections.loadPromise({ resourceNames: ['repo'] });

			try {
				expect(await existsInVirtualFs('/repo/package.json', collection.vfsId)).toBe(true);
				expect(await existsInVirtualFs('/repo/README.md', collection.vfsId)).toBe(true);
				expect(await existsInVirtualFs('/repo/node_modules/pkg/index.js', collection.vfsId)).toBe(
					false
				);
				expect(await existsInVirtualFs('/repo/dist/bundle.js', collection.vfsId)).toBe(false);
			} finally {
				await cleanupCollection(collection);
			}
		} finally {
			await fs.rm(resourcePath, { recursive: true, force: true });
		}
	});
});
