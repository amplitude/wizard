/**
 * ConfirmationInput — Continue/cancel prompt.
 * Enter confirms the focused option, Escape cancels.
 * Tab / Shift-Tab cycle between options (via Ink's focus manager).
 * Up / Down arrows toggle focus, preserved for muscle memory.
 * Options stack vertically to match PickerMenu.
 */

import { Box, Text, useFocus, useFocusManager } from 'ink';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { Icons, Colors } from '../styles.js';
import { PromptLabel } from './PromptLabel.js';

interface ConfirmationInputProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Optional id prefix used for focusable children. Lets multiple
   * ConfirmationInput instances coexist on the same screen and lets
   * tests target a specific instance, e.g. `<idPrefix>-confirm`.
   */
  idPrefix?: string;
}

interface OptionProps {
  id: string;
  label: string;
  icon: string;
  autoFocus?: boolean;
  onSelect: () => void;
}

const Option = ({ id, label, icon, autoFocus, onSelect }: OptionProps) => {
  const { isFocused } = useFocus({ id, autoFocus });

  // Each focused option owns its own Enter handler. When unfocused the
  // hook is inert (isActive=false) so we never double-fire onConfirm.
  useScreenInput(
    (_input, key) => {
      if (key.return) {
        onSelect();
      }
    },
    { isActive: isFocused },
  );

  return (
    <Text bold={isFocused} color={isFocused ? Colors.accent : Colors.muted}>
      {isFocused ? icon : ' '} {label}
    </Text>
  );
};

export const ConfirmationInput = ({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Continue [Enter]',
  cancelLabel = 'Cancel [Esc]',
  idPrefix = 'confirmation-input',
}: ConfirmationInputProps) => {
  const { focusNext, focusPrevious, focus } = useFocusManager();

  const confirmId = `${idPrefix}-confirm`;
  const cancelId = `${idPrefix}-cancel`;

  // Parent owns Escape + arrow-key cycling. Tab / Shift-Tab is handled
  // automatically by Ink's focus manager.
  useScreenInput((_input, key) => {
    if (key.upArrow) {
      focusPrevious();
      return;
    }
    if (key.downArrow) {
      focusNext();
      return;
    }
    if (key.escape) {
      // Ink's focus manager clears activeFocusId on Escape before this
      // handler runs, leaving both Options unfocused (Enter inert).
      // Re-acquire focus so the component stays interactive if onCancel
      // doesn't unmount it.
      focus(confirmId);
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      <PromptLabel message={message} />
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Option
          id={confirmId}
          label={confirmLabel}
          icon={Icons.triangleSmallRight}
          autoFocus
          onSelect={onConfirm}
        />
        <Option
          id={cancelId}
          label={cancelLabel}
          icon={Icons.triangleSmallRight}
          onSelect={onCancel}
        />
      </Box>
    </Box>
  );
};
