
import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space, type } from '../tokens';
import { PrimaryButton } from './PrimaryButton';
import { SignaturePad } from './SignaturePad';

interface SignatureSheetProps {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onSave: (uri: string) => void;
}

export function SignatureSheet({
  visible,
  title = 'Sign here',
  onClose,
  onSave,
}: SignatureSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<string | null>(null);

  // Start fresh every time the sheet opens
  useEffect(() => {
    if (visible) setDraft(null);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Backdrop: tap to dismiss */}
        <Pressable
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
          }}
        />

        {/* Sheet */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: space.md,
            paddingTop: space.sm,
            paddingBottom: Math.max(insets.bottom, space.md),
            gap: space.md,
          }}
        >
          {/* Grab handle */}
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.outline,
              opacity: 0.6,
            }}
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={[type.title, { color: colors.onSurface }]}>{title}</Text>
            <Button mode="text" onPress={onClose}>
              Cancel
            </Button>
          </View>

          <SignaturePad onSignatureChange={setDraft} />

          <PrimaryButton onPress={() => draft && onSave(draft)} disabled={!draft}>
            Save signature
          </PrimaryButton>
        </View>
      </View>
    </Modal>
  );
}