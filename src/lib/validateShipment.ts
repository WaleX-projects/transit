export type ShipmentForm = {
  senderName: string;
  receiverName: string;
  receiverPhone: string;
  description: string;
  packages: string;
  origin: string;
  destination: string;
};

export type ShipmentErrors = Partial<Record<keyof ShipmentForm | 'photos', string>>;

// Nigerian mobile: 0803 123 4567, +234 803 123 4567 or 234803...
const NG_PHONE = /^(?:\+234|234|0)[789][01]\d{8}$/;
export function validateShipment(f: ShipmentForm, photos: string[]): ShipmentErrors {
  const e: ShipmentErrors = {};
  if (photos.length === 0) e.photos = 'Add at least one photo of the goods';
  if (!f.senderName.trim()) e.senderName = 'Enter the sender name';
  if (!f.receiverName.trim()) e.receiverName = 'Enter the receiver name';
  if (!NG_PHONE.test(f.receiverPhone.replace(/[\s-]/g, ''))) {
    e.receiverPhone = 'Enter a valid phone number, e.g. 0803 123 4567';
  }
  if (!f.description.trim()) e.description = 'Describe the goods';
  const n = Number(f.packages);
  if (!Number.isInteger(n) || n < 1 || n > 99) e.packages = 'Enter a number from 1 to 99';
  if (!f.origin.trim()) e.origin = 'Required';
  if (!f.destination.trim()) e.destination = 'Required';
  if (f.origin.trim() && f.origin.trim().toLowerCase() === f.destination.trim().toLowerCase()) {
    e.destination = 'Must differ from origin';
  }
  return e;
}