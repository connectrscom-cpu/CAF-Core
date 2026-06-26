"use client";

import { useEffect } from "react";
import { LearningSectionContent } from "@/components/learning/LearningSections";
import { useLearningProject } from "@/components/learning/LearningProjectProvider";

function ContextLoader() {
  const { loadContextPreview } = useLearningProject();
  useEffect(() => {
    void loadContextPreview();
  }, [loadContextPreview]);
  return <LearningSectionContent section="context" />;
}

export default function LearningContextPage() {
  return <ContextLoader />;
}
