import React, { useState } from "react";
import { Image, Platform, Text, View } from "react-native";
import type { InlineMathToken } from "../inline-math-token";
import type { RenderContext } from "./context";
import { useFormula } from "./use-formula";

export function InlineMath({ token, context }: { token: InlineMathToken; context: RenderContext }) {
  const [source, setSource] = useState(false);
  const [failedUri, setFailedUri] = useState<string>();
  const { image, imageScale, viewportWidth } = useFormula(token.text, context.tokens,
    context.mathFontSize ?? context.metrics.bodySize, false, !source);
  if (!image || image.uri === failedUri) return token.raw;

  const availableWidth = context.mathMaxWidth ?? Math.max(1, viewportWidth - 48);
  const imageWidth = image.width * imageScale;
  const imageHeight = image.height * imageScale;
  const width = Math.min(imageWidth, availableWidth);
  const toggle = () => setSource(previous => !previous);
  if (Platform.OS === "web") {
    const label = source ? `Show formula: ${token.text}` : `Show LaTeX: ${token.text}`;
    // An out-of-flow scroller leaves the inline box's bottom edge as its baseline.
    const trackSpace = imageWidth > Math.min(availableWidth, 240) ? 8 : 0;
    return <span data-testid="better-paseo-inline-math" role="button" tabIndex={0} aria-label={label}
      onClick={event => {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        if ((!source && target.dataset.mathScroller === "true") ||
          event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false) return;
        toggle();
      }}
      onKeyDown={event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        toggle();
      }}
      style={{ cursor: "pointer", ...(source ? {} : {
        position: "relative", display: "inline-block", width, maxWidth: "100%", lineHeight: 0,
        height: imageHeight + trackSpace, verticalAlign: -image.depth * imageScale - trackSpace,
      }) }}>
      {source ? token.raw : <>
        {/* Keep the original delimiters in a browser text selection. */}
        <span aria-hidden style={{ position: "absolute", inset: 0, opacity: 0,
          fontSize: 1, lineHeight: 1, overflow: "hidden", whiteSpace: "nowrap", userSelect: "text" }}>{token.raw}</span>
        <span data-math-scroller="true" style={{ position: "absolute", inset: 0, display: "inline-block",
          overflowX: "auto", overflowY: "hidden", scrollbarWidth: "thin" }}>
          <img src={image.uri} aria-hidden alt="" draggable={false} onError={() => setFailedUri(image.uri)}
            style={{ width: imageWidth, height: "auto", maxWidth: "none", display: "block", userSelect: "none" }}
            width={imageWidth} height={imageHeight} />
        </span>
      </>}
    </span>;
  }

  const scale = width / image.width;
  if (scale < imageScale * 0.6) return token.raw;
  return <Text accessibilityRole="button" accessibilityLabel={token.text} onPress={toggle}>
    {source ? token.raw : <View style={{ width: image.width * scale, height: image.height * scale,
      transform: [{ translateY: image.depth * scale }] }}>
      <Image source={{ uri: image.uri }} accessible={false} resizeMode="contain"
        style={{ width: "100%", height: "100%" }} onError={() => setFailedUri(image.uri)} />
    </View>}
  </Text>;
}
