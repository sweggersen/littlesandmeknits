interface BringAuth {
  uid: string;
  apiKey: string;
  customerNumber: string;
}

function headers(auth: BringAuth): Record<string, string> {
  return {
    'X-MyBring-API-Uid': auth.uid,
    'X-MyBring-API-Key': auth.apiKey,
    'X-Bring-Client-URL': 'https://littlesandme.no',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

export interface ShippingEstimate {
  productId: string;
  productName: string;
  priceNok: number;
  deliveryDays: number;
}

export async function getShippingEstimate(
  auth: BringAuth,
  fromPostal: string,
  toPostal: string,
  weightGrams: number,
): Promise<ShippingEstimate[]> {
  const params = new URLSearchParams({
    frompostalcode: fromPostal,
    topostalcode: toPostal,
    fromcountry: 'NO',
    tocountry: 'NO',
    weight: String(weightGrams),
    product: 'SERVICEPAKKE',
    customerNumber: auth.customerNumber,
  });

  const res = await fetch(`https://api.bring.com/shippingguide/v2/products?${params}`, {
    headers: headers(auth),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const products = data.consignments?.[0]?.products ?? [];

  return products.map((p: any) => ({
    productId: p.id,
    productName: p.productionCode ?? p.id,
    priceNok: Math.round(p.price?.listPrice?.priceWithAdditionalServices?.amountWithVAT ?? 0),
    deliveryDays: p.expectedDelivery?.workingDays ?? 0,
  }));
}

export interface BookingResult {
  shipmentNumber: string;
  labelFreeCode?: string;
}

export async function bookShipment(
  auth: BringAuth,
  opts: {
    fromName: string;
    fromAddress: string;
    fromPostal: string;
    fromCity: string;
    toName: string;
    toAddress: string;
    toPostal: string;
    toCity: string;
    weightGrams: number;
    productId?: string;
  },
): Promise<BookingResult | null> {
  const body = {
    schemaVersion: 1,
    consignments: [{
      shippingDateTime: new Date().toISOString(),
      parties: {
        sender: {
          name: opts.fromName,
          addressLine: opts.fromAddress,
          postalCode: opts.fromPostal,
          city: opts.fromCity,
          countryCode: 'NO',
        },
        recipient: {
          name: opts.toName,
          addressLine: opts.toAddress,
          postalCode: opts.toPostal,
          city: opts.toCity,
          countryCode: 'NO',
        },
      },
      product: {
        id: opts.productId ?? 'SERVICEPAKKE',
        customerNumber: auth.customerNumber,
      },
      packages: [{
        weightInKg: opts.weightGrams / 1000,
        dimensions: { widthInCm: 20, heightInCm: 10, lengthInCm: 30 },
      }],
    }],
  };

  const res = await fetch('https://api.bring.com/booking/api/booking', {
    method: 'POST',
    headers: headers(auth),
    body: JSON.stringify(body),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const consignment = data.consignments?.[0]?.confirmation;
  if (!consignment) return null;

  return {
    shipmentNumber: consignment.consignmentNumber,
    labelFreeCode: consignment.links?.labelFreeCode,
  };
}

export interface TrackingEvent {
  status: string;
  description: string;
  dateTime: string;
  city?: string;
}

export async function getTracking(
  auth: BringAuth,
  shipmentNumber: string,
): Promise<TrackingEvent[]> {
  const res = await fetch(
    `https://tracking.bring.com/api/v2/tracking.json?q=${shipmentNumber}`,
    { headers: headers(auth) },
  );

  if (!res.ok) return [];

  const data = await res.json();
  const events = data.consignmentSet?.[0]?.packageSet?.[0]?.eventSet ?? [];

  return events.map((e: any) => ({
    status: e.status ?? '',
    description: e.description ?? '',
    dateTime: e.dateIso ?? '',
    city: e.city ?? undefined,
  }));
}
