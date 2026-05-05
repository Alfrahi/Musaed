'use client';

import { useEffect, useState } from 'react';
import { useRagProjects } from '../hooks/useRagProjects';
import { Loader2, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useActiveRagProject } from '../../../store/hooks';

interface ProjectSettingsProps {
  onClose: () => void;
}

interface EmbeddingModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  models: { name: string }[];
}

const EmbeddingModelSelect = ({ value, onChange, models }: EmbeddingModelSelectProps) => (
  <div className="space-y-1">
    <label className="text-sm font-medium">Embedding Model</label>
    {models.length > 0 ? (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
      >
        {models.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name}
          </option>
        ))}
        <option value="nomic-embed-text-v2-moe">nomic-embed-text-v2-moe (default)</option>
      </select>
    ) : (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="nomic-embed-text-v2-moe"
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
      />
    )}
    <p className="text-muted-foreground text-xs">
      Ollama embedding model. Install with: ollama pull nomic-embed-text-v2-moe
    </p>
  </div>
);

const useEmbeddingModels = () => {
  const [embeddingModels, setEmbeddingModels] = useState<{ name: string }[]>([]);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        if (data.models) setEmbeddingModels(data.models);
      } catch (err) {
        console.error('Failed to fetch embedding models:', err);
      }
    };
    fetchModels();
  }, []);

  return embeddingModels;
};

const ProjectSettingsActions = ({
  onClose,
  onSave,
  isSaving,
}: {
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
}) => (
  <div className="flex justify-end gap-2 border-t pt-2">
    <button
      type="button"
      className="hover:bg-accent rounded-md border px-4 py-2 text-sm"
      onClick={onClose}
    >
      Cancel
    </button>
    <button
      type="button"
      className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm disabled:opacity-50"
      onClick={onSave}
      disabled={isSaving}
    >
      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      Save
    </button>
  </div>
);

const ProjectSettingsForm = ({ onClose }: { onClose: () => void }) => {
  const { updateProjectById } = useRagProjects();
  const activeProject = useActiveRagProject();
  const [name, setName] = useState(activeProject?.name ?? '');
  const [ignorePatterns, setIgnorePatterns] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState(activeProject?.embeddingModel ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const embeddingModels = useEmbeddingModels();

  useEffect(() => {
    if (activeProject) {
      setName(activeProject.name);
      setEmbeddingModel(activeProject.embeddingModel);
      setIgnorePatterns(activeProject.ignorePatterns.join('\n'));
    }
  }, [activeProject]);

  const handleSave = async () => {
    if (!activeProject?.id) return;
    setIsSaving(true);
    try {
      const updates: { name?: string; ignorePatterns?: string[] } = {};
      if (name !== activeProject.name) updates.name = name;

      const newPatterns = ignorePatterns
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (JSON.stringify(newPatterns) !== JSON.stringify(activeProject.ignorePatterns)) {
        updates.ignorePatterns = newPatterns;
      }

      if (Object.keys(updates).length > 0) {
        await updateProjectById(activeProject.id, updates);
        toast.success('Project updated');
      }

      if (embeddingModel !== activeProject.embeddingModel) {
        toast.success('Embedding model updated — project will be reindexed.');
      }
      onClose();
    } catch {
      toast.error('Failed to update project');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto">
      <div className="space-y-1">
        <label className="text-sm font-medium">Project Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>
      <EmbeddingModelSelect
        value={embeddingModel}
        onChange={setEmbeddingModel}
        models={embeddingModels}
      />
      <div className="space-y-1">
        <label className="text-sm font-medium">Ignore Patterns</label>
        <textarea
          value={ignorePatterns}
          onChange={(e) => setIgnorePatterns(e.target.value)}
          rows={5}
          placeholder="node_modules\ndist\n.git"
          className="border-input bg-background w-full rounded-md border px-3 py-2 font-mono text-sm"
        />
        <p className="text-muted-foreground text-xs">One pattern per line.</p>
      </div>
      <ProjectSettingsActions onClose={onClose} onSave={handleSave} isSaving={isSaving} />
    </div>
  );
};

const ProjectSettings = ({ onClose }: ProjectSettingsProps) => {
  const activeProject = useActiveRagProject();

  if (!activeProject) {
    return <div className="text-muted-foreground p-4 text-sm">No active project selected.</div>;
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Project Settings</h2>
        <button type="button" className="hover:bg-accent rounded-md p-1" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <ProjectSettingsForm onClose={onClose} />
    </div>
  );
};

export { ProjectSettings };
