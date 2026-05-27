import React from "react";

export interface ScenePrompt {
  scene_number: number;
  scene_title: string;
  prompt_text: string;
  images?: any[];
}

export type Scene = ScenePrompt;

interface SceneCardProps {
  scene: Scene;
}

const SceneCard: React.FC<SceneCardProps> = ({ scene }) => {
  const formattedText = scene.prompt_text
    .replace(/(\[SCENE_START\])/g, "$1")
    .replace(
      /(SCENE_HEADING:|CHARACTER:|CINEMATOGRAPHY:|LIGHTING:|ENVIRONMENT:|ACTION_EMOTION:|STYLE:)/g,
      '\n<strong class="text-emerald-300">$&</strong>',
    );

  return (
    <div className="scene-card glass-card rounded-lg p-4 border border-white/20 shadow-md flex flex-col w-full">
      <h3 className="font-bold text-sm text-black mb-2 shrink-0">
        🎬 Scene {scene.scene_number}: {scene.scene_title}
      </h3>

      <div className="w-full">
        <p
          className="text-white text-[11px] bg-black/40 p-4 rounded-xl font-mono break-words whitespace-pre-wrap leading-relaxed shadow-inner"
          dangerouslySetInnerHTML={{ __html: formattedText }}
        />
      </div>
    </div>
  );
};

interface ResultsProps {
  scenes: Scene[];
}

const Results: React.FC<ResultsProps> = ({ scenes }) => {
  if (!scenes || scenes.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 pb-10 w-full">
      <div className="flex justify-center mb-6">
        <span className="text-base font-semibold text-gray-900 hidden sm:block uppercase">
          KỊCH BẢN PROMPT CỦA BẠN
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-10">
        {scenes.map((s) => (
          <SceneCard key={s.scene_number} scene={s} />
        ))}
      </div>
    </div>
  );
};

export default Results;
