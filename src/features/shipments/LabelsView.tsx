import * as Print from 'expo-print';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';
import { getDb } from '../../data/db';
import { copy } from '../../lib/copy';
import { radius, size, space, type } from '../../tokens';
import { AppBar } from '../../ui/AppBar';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';

interface LabelsData {
  shipment: {
    id: string;
    waybill_no: string;
    receiver_name: string;
    origin_name: string;
    destination_name: string;
  };
  packages: Array<{
    id: string;
    seq: number;
    label_code: string;
    description: string;
  }>;
}

interface LabelsViewProps {
  shipmentId: string;
}

export function LabelsView({ shipmentId }: LabelsViewProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const [data, setData] = useState<LabelsData | null>(null);

  useEffect(() => {
    async function loadData() {
      const db = await getDb();
      const shipment = await db.getFirstAsync<{
        id: string;
        waybill_no: string;
        receiver_name: string;
        origin_name: string;
        destination_name: string;
      }>(
        `SELECT s.id, s.waybill_no, s.receiver_name, o.name as origin_name, d.name as destination_name
         FROM shipments s
         JOIN locations o ON o.id = s.origin_id
         JOIN locations d ON d.id = s.destination_id
         WHERE s.id = ?`,
        [shipmentId]
      );

      const packages = await db.getAllAsync<{
        id: string;
        seq: number;
        label_code: string;
        description: string;
      }>(
        `SELECT id, seq, label_code, description FROM packages WHERE shipment_id = ? ORDER BY seq ASC`,
        [shipmentId]
      );

      if (shipment) {
        setData({ shipment, packages });
      }
    }

    loadData();
  }, [shipmentId]);

  if (!data) return null;

  const total = data.packages.length;
  console.log("data",data)
  function buildHtml(): string {
    if (!data) return '';
    const summaryPage = `
      <div style="font-family: sans-serif; padding: 40px; page-break-after: always;">
        <h1 style="font-size: 28px; margin: 0;">Ega Osas Transport and Logistics</h1>
        <h2 style="font-size: 36px; margin: 20px 0; color: ${colors.primary};">${data.shipment.waybill_no}</h2>
        <p style="font-size: 20px;"><strong>Route:</strong> ${data.shipment.origin_name} &rarr; ${data.shipment.destination_name}</p>
        <p style="font-size: 20px;"><strong>Receiver:</strong> ${data.shipment.receiver_name}</p>
        <p style="font-size: 20px;"><strong>Total Packages:</strong> ${total}</p>
      </div>
    `;

    const packagePages = data.packages
      .map(
        (pkg) => `
      <div style="font-family: sans-serif; padding: 40px; text-align: center; page-break-after: always;">
        <h2 style="font-size: 24px; margin: 0;">${data.shipment.waybill_no}</h2>
        <h1 style="font-size: 32px; margin: 16px 0;">${pkg.label_code}</h1>
        <p style="font-size: 18px; margin: 8px 0;">Item ${pkg.seq} of ${total}</p>
        <p style="font-size: 16px; color: ${colors.onSurfaceVariant};">${pkg.description}</p>
      </div>
    `
      )
      .join('');

    return `<html><body>${summaryPage}${packagePages}</body></html>`;
  }

  async function handlePrint() {
    const html = buildHtml();
    await Print.printAsync({ html });
  }

  async function handleSharePdf() {
    const html = buildHtml();
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri);
  }

  return (
    <Screen>
      <AppBar title="Labels" />

      {/* Summary Card */}
      <View
        style={{
          padding: space.md,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.outline,
          gap: space.xs,
        }}
      >
        <Text style={[type.stat, { color: colors.primary }]}>
          {data.shipment.waybill_no}
        </Text>
        <Text style={[type.body, { color: colors.onSurface }]}>
          {data.shipment.origin_name} → {data.shipment.destination_name}
        </Text>
        <Text style={[type.body, { color: colors.onSurface }]}>
          {data.shipment.receiver_name}
        </Text>
        <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
          {copy.labels.packageCount(total)}
        </Text>
      </View>

      {/* Package Cards */}
      {data.packages.map((pkg) => (
        <View
          key={pkg.id}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            padding: space.lg,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.outline,
            gap: space.md,
          }}
        >
          <QRCode value={pkg.label_code} size={size.qr} />
          <View style={{ alignItems: 'center', gap: space.xs }}>
            <Text style={[type.heading, { color: colors.onSurface, textAlign: 'center' }]}>
              {pkg.label_code}
            </Text>
            <Text style={[type.caption, { color: colors.onSurfaceVariant, textAlign: 'center' }]}>
              {copy.labels.itemSeq(pkg.seq, total)}
            </Text>
          </View>
        </View>
      ))}

      {/* Action Buttons */}
      <View style={{ gap: space.sm }}>
        <PrimaryButton icon="printer" onPress={handlePrint}>
          {copy.labels.printLabels}
        </PrimaryButton>

        <PrimaryButton variant="outline" icon="share-variant" onPress={handleSharePdf}>
          {copy.labels.sharePdf}
        </PrimaryButton>

        <Button
          mode="text"
          textColor={colors.primary}
          onPress={() => router.replace('/(tabs)/shipments')}
        >
          {copy.labels.done}
        </Button>
      </View>
    </Screen>
  );
}
