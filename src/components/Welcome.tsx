import AiMascot from "./AiMascot";

interface Props {
  name: string;
  disabled: boolean;
  onPick: (text: string) => void;
}

const suggestions = [
  "Bakıdan İstanbula 10 palet yük üçün sorğu yarat",
  "Bütün RFQ-ları siyahıla",
  "Daşıyıcı bazamı göstər",
  "Gələn təklifləri müqayisə et",
  "Bütün sorğuların Excel hesabatını hazırla",
];

/** The empty chat: the AI's face, a greeting and a few things to try. */
export default function Welcome({ name, disabled, onPick }: Props) {
  return (
    <div className="welcome">
      <AiMascot size={168} />
      <h1 className="welcome-title">{name ? `Salam, ${name}!` : "Salam!"}</h1>
      <p className="welcome-sub">
        Mən Arachi AI köməkçinizəm. Sorğu yarada və daşıyıcılara göndərə, təklifləri müqayisə edə, PDF təklif və hesabat
        hazırlaya bilərəm. Nə etmək istədiyinizi yazın və ya fayl əlavə edin.
      </p>
      <div className="welcome-chips">
        {suggestions.map((text) => (
          <button key={text} type="button" className="welcome-chip" disabled={disabled} onClick={() => onPick(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
