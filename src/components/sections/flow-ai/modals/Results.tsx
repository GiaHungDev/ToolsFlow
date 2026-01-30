import React from "react";

export interface ScenePrompt {
  scene_number: number;
  scene_title: string;
  prompt_text: string;
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
      '\n<strong class="text-indigo-300">$&</strong>',
    );

  return (
    <div className="scene-card glass-card rounded-lg p-4 border border-white/20 shadow-md flex flex-col h-[400px] w-full overflow-hidden">
      <h3 className="font-bold text-sm text-indigo-100 mb-2 shrink-0">
        🎬 Scene {scene.scene_number}: {scene.scene_title}
      </h3>

      {/* SỬA TẠI ĐÂY: 
          1. Thêm min-h-0 để flex-1 có thể thu nhỏ nội dung bên trong.
          2. Đảm bảo container này có chiều cao đầy đủ (h-full hoặc flex-1)
      */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-2 custom-scrollbar">
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
    <div className="mt-10 pb-10">
      <h2 className="text-2xl font-black text-stone-700 text-center mb-8 uppercase tracking-widest">
        ✨ Kịch Bản Prompt Của Bạn
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {scenes.map((s) => (
          <SceneCard key={s.scene_number} scene={s} />
        ))}
      </div>
    </div>
  );
};

export default Results;
