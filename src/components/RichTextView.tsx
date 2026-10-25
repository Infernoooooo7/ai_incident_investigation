import { Fragment } from 'react';
import type { RichText } from '../domain/richText';

/** A compact button that selects an event; announced as "Show event evt_04". */
export function EventLink({
  eventId,
  onSelect,
}: {
  eventId: string;
  onSelect: (eventId: string) => void;
}) {
  return (
    <button
      type="button"
      className="event-link"
      aria-label={`Show event ${eventId}`}
      onClick={() => onSelect(eventId)}
    >
      {eventId}
    </button>
  );
}

interface RichTextViewProps {
  value: RichText;
  /** When provided, event references become buttons that select the event. */
  onSelectEvent?: (eventId: string) => void;
}

export function RichTextView({ value, onSelectEvent }: RichTextViewProps) {
  return (
    <>
      {value.map((segment, index) => {
        switch (segment.type) {
          case 'text':
            return <Fragment key={index}>{segment.text}</Fragment>;
          case 'code':
            return (
              <code key={index} className="inline-code">
                {segment.text}
              </code>
            );
          case 'event':
            return onSelectEvent ? (
              <EventLink key={index} eventId={segment.eventId} onSelect={onSelectEvent} />
            ) : (
              <code key={index} className="inline-code">
                {segment.eventId}
              </code>
            );
        }
      })}
    </>
  );
}
