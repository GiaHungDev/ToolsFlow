import React from "react";

export const useCreateVideo = () => {
  const [openTopicModal, setOpenTopicModal] = React.useState(false);
  const [openPromptModal, setOpenPromptModal] = React.useState(false);

  const handleOpenTopicModal = () => {
    setOpenTopicModal(true);
  };

  const handleCancelTopicModal = () => {
    setOpenTopicModal(false);
  };

  const handleOpenPromptModal = () => {
    setOpenPromptModal(true);
  };

  const handleCancelPromptModal = () => {
    setOpenPromptModal(false);
  };

  return {
    openTopicModal,
    setOpenTopicModal,
    handleOpenTopicModal,
    handleCancelTopicModal,
    openPromptModal,
    setOpenPromptModal,
    handleOpenPromptModal,
    handleCancelPromptModal,
  };
};
