import React, { useEffect, useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

const PRIORITIES = ["critical", "high", "medium", "low"] as const;
const FIELDS = ["title", "description", "priority"] as const;

type ComposerField = (typeof FIELDS)[number];

export interface IssueComposerValues {
  title: string;
  description: string;
  priority: (typeof PRIORITIES)[number];
}

export interface IssueComposerOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (values: IssueComposerValues) => Promise<void>;
}

export function IssueComposerOverlay({
  visible,
  onDismiss,
  onSubmit,
}: IssueComposerOverlayProps): React.ReactElement | null {
  const [field, setField] = useState<ComposerField>("title");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priorityIndex, setPriorityIndex] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setField("title");
    setTitle("");
    setDescription("");
    setPriorityIndex(1);
    setSubmitting(false);
    setError(null);
  }, [visible]);

  const cycleField = useCallback((direction: 1 | -1 = 1) => {
    setField((current) => {
      const currentIndex = FIELDS.indexOf(current);
      const nextIndex = (currentIndex + direction + FIELDS.length) % FIELDS.length;
      return FIELDS[nextIndex] ?? "title";
    });
  }, []);

  const cyclePriority = useCallback((direction: 1 | -1) => {
    setPriorityIndex((current) => (
      current + direction + PRIORITIES.length
    ) % PRIORITIES.length);
  }, []);

  const submit = useCallback(async () => {
    if (!title.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        priority: PRIORITIES[priorityIndex] ?? "high",
      });
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create issue");
    } finally {
      setSubmitting(false);
    }
  }, [description, onDismiss, onSubmit, priorityIndex, submitting, title]);

  useInput(
    (input, key) => {
      if (!visible) {
        return;
      }
      if (key.escape) {
        onDismiss();
        return;
      }
      if (key.tab) {
        cycleField();
        return;
      }
      if (field === "priority" && key.leftArrow) {
        cyclePriority(-1);
        return;
      }
      if (field === "priority" && key.rightArrow) {
        cyclePriority(1);
        return;
      }
      if (field === "priority" && key.return) {
        void submit();
      }
    },
    { isActive: visible },
  );

  if (!visible) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      alignSelf="center"
      width="80%"
    >
      <Text bold color="cyan">
        New Issue
      </Text>
      <Text dimColor>
        Title first, then a short description. Use Tab to reach priority.
      </Text>
      <Text> </Text>
      <Text bold color={field === "title" ? "cyan" : "yellow"}>
        {field === "title" ? "› " : ""}Title
      </Text>
      <TextInput
        value={title}
        onChange={setTitle}
        focus={field === "title" && !submitting}
        placeholder="What needs to happen?"
        onSubmit={() => {
          if (title.trim()) {
            setField("description");
          }
        }}
      />
      <Text> </Text>
      <Text bold color={field === "description" ? "cyan" : "yellow"}>
        {field === "description" ? "› " : ""}Description
      </Text>
      <TextInput
        value={description}
        onChange={setDescription}
        focus={field === "description" && !submitting}
        placeholder="Why this matters / next constraint"
        onSubmit={() => {
          setField("priority");
        }}
      />
      <Text> </Text>
      <Text color={field === "priority" ? "cyan" : undefined}>
        {field === "priority" ? "› " : ""}Priority: <Text color="yellow">{PRIORITIES[priorityIndex]}</Text>
      </Text>
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>
        Enter advances fields and submits from priority · Tab switches field · ←/→ change priority · Esc closes
      </Text>
      {submitting ? <Text color="yellow">Creating issue…</Text> : null}
    </Box>
  );
}
