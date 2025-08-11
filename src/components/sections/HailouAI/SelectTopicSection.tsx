"use client";

import FlexibleCombobox from "@/components/shared/CSelect";
import React from "react";

const SelectTopicSection = () => {
  const [selectedFramework, setSelectedFramework] = React.useState("");

  const frameworks = [
    { value: "next.js", label: "Next.js" },
    { value: "sveltekit", label: "SvelteKit" },
    { value: "nuxt.js", label: "Nuxt.js" },
    { value: "remix", label: "Remix", disabled: true },
    { value: "astro", label: "Astro" },
  ];

  return (
    <>
      <FlexibleCombobox
        options={frameworks}
        value={selectedFramework}
        onValueChange={setSelectedFramework}
        placeholder="Chọn chủ đề..."
        searchPlaceholder="Tìm chủ đề..."
        emptyMessage="Không tìm thấy chủ đề."
        size="md"
        clearable
      />
    </>
  );
};

export default SelectTopicSection;
