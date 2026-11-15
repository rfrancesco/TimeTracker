import { useState } from 'react';
import {
  IonContent, IonHeader, IonIcon, IonLabel, IonPage, IonSegment, IonSegmentButton, IonTitle, IonToolbar,
} from '@ionic/react';
import { barChartOutline } from 'ionicons/icons';

type Range = 'week' | 'month' | 'year';

export default function ReportPage() {
  const [range, setRange] = useState<Range>('week');
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Reports</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={range} onIonChange={(e) => setRange(e.detail.value as Range)}>
            <IonSegmentButton value="week"><IonLabel>Week</IonLabel></IonSegmentButton>
            <IonSegmentButton value="month"><IonLabel>Month</IonLabel></IonSegmentButton>
            <IonSegmentButton value="year"><IonLabel>Year</IonLabel></IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <div className="empty-state">
          <IonIcon icon={barChartOutline} />
          <p>Reports are coming soon.</p>
        </div>
      </IonContent>
    </IonPage>
  );
}
