export function SupportExperience({ channel, loading, error }) {
  if (loading) {
    return (
      <section className="support-experience support-experience--loading" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>正在打开产品支持服务…</span>
      </section>
    )
  }

  if (error || !channel) {
    return (
      <section className="support-experience support-experience--error" role="alert">
        <strong>该产品支持入口暂不可用</strong>
        <span>{error || '请联系管理员获取有效的产品支持二维码。'}</span>
      </section>
    )
  }

  return (
    <section className="support-experience" aria-label="当前产品支持范围">
      <span className="support-experience__eyebrow">产品专属支持</span>
      <div>
        <strong>{channel.displayName}</strong>
        <span>{channel.productLine} · {channel.productModel}</span>
      </div>
    </section>
  )
}
