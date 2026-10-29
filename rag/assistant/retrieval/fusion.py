"""Reciprocal rank fusion for vector and lexical retrieval results."""

RRF_K = 60


def reciprocal_rank_fusion(search_results, limit, rank_constant=RRF_K):
    scores = {}
    for chunks in search_results:
        for chunk in chunks:
            scores[chunk.content] = scores.get(chunk.content, 0.0) + 1 / (rank_constant + chunk.rank)
    return sorted(scores.items(), key=lambda item: item[1], reverse=True)[:limit]
