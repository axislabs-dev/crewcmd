import { Composition } from "remotion";
import { CrewCmdIntro } from "./CrewCmdIntro";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CrewCmdIntro"
        component={CrewCmdIntro}
        durationInFrames={900}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  );
};
