
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { HelperText, IconButton, Text, useTheme } from 'react-native-paper';
import { radius, size, space, type } from '../tokens';

interface PhotoPickerProps {
  label?: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  error?: string;
  max?: number;
}

export function PhotoPicker({
  label = 'Photograph the goods',
  photos,
  onChange,
  error,
  max = 5,
}: PhotoPickerProps) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();

  const [cameraVisible, setCameraVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cameraRef = useRef<CameraView>(null);

  const isFull = photos.length >= max;

  async function handleAddPhoto() {
    if (isFull || busy) return;

    setMessage(null);

    if (!permission?.granted) {
      const result = await requestPermission();

      if (!result.granted) {
        setMessage('Camera permission is needed to photograph the goods.');
        return;
      }
    }

    setCameraVisible(true);
  }

  async function handleCapture() {
    if (!cameraRef.current || busy || isFull) return;

    try {
      setBusy(true);

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
      });

      if (photo?.uri) {
        onChange([...photos, photo.uri]);
        setCameraVisible(false);
      }
    } catch (err) {
      console.error('[PhotoPicker] Camera capture failed:', err);
      setMessage('Could not capture the photo. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleRemovePhoto(index: number) {
    onChange(photos.filter((_, i) => i !== index));
  }

  const borderColor = error ? colors.error : colors.outline;

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.label, { color: colors.onSurface }]}>
        {label}
      </Text>

      {photos.length === 0 ? (
        <Pressable
          onPress={handleAddPhoto}
          disabled={busy}
        >
          <View
            style={{
              height: size.photoBox,
              borderWidth: 1,
              borderColor,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
              gap: space.xs,
            }}
          >
            <MaterialCommunityIcons
              name="camera-plus"
              size={size.iconLg}
              color={colors.primary}
            />

            <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
              Tap to take photo
            </Text>
          </View>
        </Pressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm }}
        >
          {photos.map((uri, index) => (
            <View key={uri + index} style={{ position: 'relative' }}>
              <Image
                source={{ uri }}
                style={{
                  width: size.thumb,
                  height: size.thumb,
                  borderRadius: radius.sm,
                  backgroundColor: colors.surface,
                }}
              />

              <View style={{ position: 'absolute', top: 0, right: 0 }}>
                <IconButton
                  icon="close-circle"
                  size={size.icon}
                  iconColor={colors.error}
                  onPress={() => handleRemovePhoto(index)}
                />
              </View>
            </View>
          ))}

          {!isFull && (
            <Pressable onPress={handleAddPhoto} disabled={busy}>
              <View
                style={{
                  width: size.thumb,
                  height: size.thumb,
                  borderWidth: 1,
                  borderColor: colors.outline,
                  borderRadius: radius.sm,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.surface,
                }}
              >
                <MaterialCommunityIcons
                  name="plus"
                  size={size.icon}
                  color={colors.primary}
                />
              </View>
            </Pressable>
          )}
        </ScrollView>
      )}

      {!!(error || message) && (
        <HelperText type="error" visible style={{ paddingHorizontal: 0 }}>
          {error || message}
        </HelperText>
      )}

      <Modal
        visible={cameraVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setCameraVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            facing="back"
          />

          <View
            style={{
              position: 'absolute',
              top: 50,
              left: 20,
              right: 20,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <IconButton
              icon="close"
              iconColor="#fff"
              size={30}
              onPress={() => setCameraVisible(false)}
            />

            <Text style={{ color: '#fff' }}>
              {photos.length} / {max} photos
            </Text>
          </View>

          <View
            style={{
              position: 'absolute',
              bottom: 40,
              left: 0,
              right: 0,
              alignItems: 'center',
            }}
          >
            <Pressable
              onPress={handleCapture}
              disabled={busy || isFull}
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                borderWidth: 5,
                borderColor: '#fff',
                backgroundColor: busy ? '#777' : '#fff',
                opacity: busy ? 0.5 : 1,
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
