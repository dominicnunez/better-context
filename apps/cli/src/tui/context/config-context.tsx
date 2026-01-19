import {
	createContext,
	createSignal,
	createResource,
	createEffect,
	useContext,
	type Accessor,
	type Component,
	type ParentProps
} from 'solid-js';
import type { Repo } from '../types.ts';
import { services } from '../services.ts';

type ConfigState = {
	selectedModel: Accessor<string>;
	selectedProvider: Accessor<string>;
	setModel: (model: string) => void;
	setProvider: (provider: string) => void;
	repos: Accessor<Repo[]>;
	addRepo: (repo: Repo) => void;
	removeRepo: (name: string) => void;
	loading: Accessor<boolean>;
};

const ConfigContext = createContext<ConfigState>();

export const useConfigContext = () => {
	const context = useContext(ConfigContext);
	if (!context) throw new Error('useConfigContext must be used within ConfigProvider');
	return context;
};

const fetchInitialConfig = async () => {
	const [reposList, modelConfig] = await Promise.all([services.getRepos(), services.getModel()]);
	return { repos: reposList, provider: modelConfig.provider, model: modelConfig.model };
};

export const ConfigProvider: Component<ParentProps> = (props) => {
	const [initialConfig] = createResource(fetchInitialConfig);

	const [selectedModel, setSelectedModel] = createSignal('');
	const [selectedProvider, setSelectedProvider] = createSignal('');
	const [repos, setRepos] = createSignal<Repo[]>([]);

	createEffect(() => {
		const config = initialConfig();
		if (config) {
			setSelectedModel(config.model);
			setSelectedProvider(config.provider);
			setRepos(config.repos);
		}
	});

	const state: ConfigState = {
		selectedModel,
		selectedProvider,
		setModel: setSelectedModel,
		setProvider: setSelectedProvider,
		repos,
		addRepo: (repo) => setRepos((prev) => [...prev, repo]),
		removeRepo: (name) => setRepos((prev) => prev.filter((r) => r.name !== name)),
		loading: () => initialConfig.loading
	};

	return <ConfigContext.Provider value={state}>{props.children}</ConfigContext.Provider>;
};
