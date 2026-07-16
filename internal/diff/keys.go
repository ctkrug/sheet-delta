package diff

// interner maps strings to dense uint64 keys where equal strings — and
// only equal strings — get equal keys.
//
// alignKeys compares opaque uint64s, so rows and headers must be reduced
// to numbers first. Interning is used rather than hashing because a hash
// collision would silently mark two different rows as the same row, which
// is a wrong diff presented with full confidence. Interning cannot
// collide, and it is faster than a cryptographic hash besides.
type interner struct {
	ids map[string]uint64
}

func newInterner(sizeHint int) *interner {
	return &interner{ids: make(map[string]uint64, sizeHint)}
}

// key returns the stable key for s, assigning a new one on first sight.
func (in *interner) key(s string) uint64 {
	if id, ok := in.ids[s]; ok {
		return id
	}
	id := uint64(len(in.ids))
	in.ids[s] = id
	return id
}
