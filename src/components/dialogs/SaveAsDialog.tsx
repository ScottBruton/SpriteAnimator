import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { exportProjectBackup } from '@/exporters/exportService';
import { useEditorStore } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { saveProjectAsFolder, supportsFolderWorkspace } from '@/storage/projectService';
import { colors, font } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { TextField } from '../ui/Fields';

/**
 * Save As: primary path is a live project folder on disk (Chrome/Edge).
 * Optional zip backup download remains available.
 */
export function SaveAsDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const setStatus = useEditorStore((s) => s.setStatus);
  const folderOk = supportsFolderWorkspace();

  const isAbort = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || /abort|cancel/i.test(e.message));

  const saveToFolder = async () => {
    setBusy(true);
    try {
      const msg = await saveProjectAsFolder(name.trim() || 'Untitled');
      setStatus(msg, 'success');
      onClose();
    } catch (e) {
      if (isAbort(e)) return;
      setStatus(`Save As failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveZipBackup = async () => {
    const n = name.trim() || 'Untitled';
    setBusy(true);
    try {
      if (n !== project.name) {
        useProjectStore.getState().commit('Rename project', (d) => {
          d.name = n;
        });
      }
      const msg = await exportProjectBackup(n);
      setStatus(msg, 'success');
      onClose();
    } catch (e) {
      setStatus(`Zip backup failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      visible
      title="Save As"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button label="Cancel" onPress={onClose} disabled={busy} />
          {folderOk ? (
            <Button label={busy ? 'Saving…' : 'Choose folder…'} primary disabled={busy} onPress={saveToFolder} />
          ) : (
            <Button label={busy ? 'Saving…' : 'Download .ess.zip'} primary disabled={busy} onPress={saveZipBackup} />
          )}
        </>
      }
    >
      <TextField label="Project name" value={name} onChange={setName} autoFocus onSubmit={folderOk ? saveToFolder : saveZipBackup} />
      {folderOk ? (
        <>
          <Text style={styles.hint}>
            Creates a folder named <Text style={styles.mono}>{name.trim() || 'Untitled'}</Text> inside the location you pick
            (with project.json, assets/, audio/). Save then writes into that folder.
          </Text>
          <Button label="Download .ess.zip backup…" disabled={busy} onPress={saveZipBackup} />
        </>
      ) : (
        <Text style={styles.hint}>
          Folder workspaces need Chrome or Edge. This browser can download{' '}
          <Text style={styles.mono}>{name.trim() || 'project'}.ess.zip</Text> instead.
        </Text>
      )}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.textDim, fontSize: font.xs, lineHeight: 15 },
  mono: { fontFamily: font.mono, color: colors.textMuted },
});
