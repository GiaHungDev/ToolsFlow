import React from "react";

export const useCreateVideo = () => {
  const [openTopicT2VModal, setOpenTopicT2VModal] = React.useState(false);
  const [openTopicModal, setOpenTopicModal] = React.useState(false);
  const [openPromptModal, setOpenPromptModal] = React.useState(false);
  const [openT2VPromptModal, setOpenT2VPromptModal] = React.useState(false);
  const [openListPromptModal, setOpenListPromptModal] = React.useState(false);

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

  const handleOpenT2VPromptModal = () => setOpenT2VPromptModal(true);
  const handleCloseT2VPromptModal = () => setOpenT2VPromptModal(false);

  const handleOpenListPromptModal = () => setOpenListPromptModal(true);
  const handleCloseListPromptModal = () => setOpenListPromptModal(false);

  const handleOpenTopicT2VModal = () => setOpenTopicT2VModal(true);
  const handleCloseTopicT2VModal = () => setOpenTopicT2VModal(false);

  return {
    openTopicModal,
    setOpenTopicModal,
    handleOpenTopicModal,
    handleCancelTopicModal,
    openPromptModal,
    setOpenPromptModal,
    handleOpenPromptModal,
    handleCancelPromptModal,
    openT2VPromptModal,
    setOpenT2VPromptModal,
    handleOpenT2VPromptModal,
    handleCloseT2VPromptModal,
    openListPromptModal,
    setOpenListPromptModal,
    handleOpenListPromptModal,
    handleCloseListPromptModal,
    openTopicT2VModal,
    setOpenTopicT2VModal,
    handleOpenTopicT2VModal,
    handleCloseTopicT2VModal,
  };
};
